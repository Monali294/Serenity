"""
insights_routes.py
Route logic for Serenity's Insights page — plain functions (not a
Blueprint), matching the rest of your app.py's style. See the bottom
of this file for exactly how to wire these into app.py.

ASSUMPTIONS (adjust if these don't match your app):
  1. `from db_config import get_db_connection` — returns a mysql.connector
     connection, same pattern used elsewhere.
  2. `session['user_id']` holds the logged-in user's id. (Confirmed
     against your app.py.)
  3. Flask-WTF's CSRFProtect(app) is already initialized. (Confirmed.)

Tables used (matching what you shared):
  mood_logs(id, user_id, mood ENUM(...), logged_at)
  journal_entries(id, user_id, title, journal_text, sentiment, emotion,
                   ai_summary, entry_date, created_at)
  sleep_logs(id, user_id, sleep_start, wake_time, sleep_duration_minutes,
             sleep_quality ENUM(...), log_date, created_at)
  user_habits(id, user_id, habit_id, created_at)
  habit_logs(id, user_id, habit_id, completed, log_date, created_at)

One new table needed — run this once to enable caching of the AI
narrative (avoids calling the LLM on every single page view):

  CREATE TABLE insight_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      period VARCHAR(10) NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      narrative TEXT,
      correlations_json TEXT,
      generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_period (user_id, period, period_start)
  );
"""

from flask import render_template, request, session, jsonify, redirect, url_for, flash
from datetime import date, timedelta
import json

from db_config import get_db_connection  # adjust if your helper is named differently
from groq_client import groq_chat, AIUnavailable


# =====================================================
# SCORING CONSTANTS
# =====================================================
MOOD_SCORE_MAP = {
    'Happy': 100,
    'Calm': 85,
    'Neutral': 60,
    'Sad': 35,
    'Stressed': 20,
}

SLEEP_QUALITY_SCORE_MAP = {
    'Deep Sleep': 100,
    'Restorative': 85,
    'Balanced': 65,
    'Light Sleep': 45,
    'Restless': 25,
}

IDEAL_SLEEP_MINUTES = 480  # 8 hours

# Weights for the composite wellness score
WEIGHT_MOOD = 0.40
WEIGHT_SLEEP = 0.35
WEIGHT_HABITS = 0.25


def duration_score(minutes):
    """0-100 score based on distance from the 8-hour ideal."""
    if minutes is None:
        return None
    diff = abs(IDEAL_SLEEP_MINUTES - minutes)
    return max(0, round(100 - diff / 4))  # loses ~1pt per 4 min away from ideal


def sleep_score_for_log(duration_minutes, quality):
    """Blends duration-based and quality-based scoring for one night."""
    d_score = duration_score(duration_minutes)
    q_score = SLEEP_QUALITY_SCORE_MAP.get(quality)
    scores = [s for s in (d_score, q_score) if s is not None]
    return round(sum(scores) / len(scores)) if scores else None


# =====================================================
# DATE RANGE HELPERS
# =====================================================
def get_period_range(period, today=None):
    """Returns (start_date, end_date, previous_start, previous_end, range_label)."""
    today = today or date.today()

    if period == 'daily':
        start, end = today, today
        prev_start = prev_end = today - timedelta(days=1)
        label = today.strftime('%A, %B %d')
    elif period == 'monthly':
        start, end = today - timedelta(days=29), today
        prev_start, prev_end = today - timedelta(days=59), today - timedelta(days=30)
        label = f"{start.strftime('%b %d')} \u2013 {end.strftime('%b %d, %Y')}"
    else:  # weekly (default)
        period = 'weekly'
        start, end = today - timedelta(days=6), today
        prev_start, prev_end = today - timedelta(days=13), today - timedelta(days=7)
        label = f"{start.strftime('%b %d')} \u2013 {end.strftime('%b %d, %Y')}"

    return start, end, prev_start, prev_end, label


def date_range_list(start, end):
    days = (end - start).days
    return [start + timedelta(days=i) for i in range(days + 1)]


# =====================================================
# DATA FETCHERS
# =====================================================
def fetch_mood_logs(cursor, user_id, start, end):
    cursor.execute(
        "SELECT mood, DATE(logged_at) AS log_day FROM mood_logs "
        "WHERE user_id = %s AND DATE(logged_at) BETWEEN %s AND %s",
        (user_id, start, end)
    )
    return cursor.fetchall()


def fetch_sleep_logs(cursor, user_id, start, end):
    cursor.execute(
        "SELECT log_date, sleep_duration_minutes, sleep_quality FROM sleep_logs "
        "WHERE user_id = %s AND log_date BETWEEN %s AND %s",
        (user_id, start, end)
    )
    return cursor.fetchall()


def fetch_habit_logs(cursor, user_id, start, end):
    cursor.execute(
        "SELECT log_date, completed FROM habit_logs "
        "WHERE user_id = %s AND log_date BETWEEN %s AND %s",
        (user_id, start, end)
    )
    return cursor.fetchall()


def fetch_journal_entries(cursor, user_id, start, end):
    cursor.execute(
        "SELECT entry_date, sentiment, emotion FROM journal_entries "
        "WHERE user_id = %s AND entry_date BETWEEN %s AND %s",
        (user_id, start, end)
    )
    return cursor.fetchall()


def count_active_habits(cursor, user_id):
    cursor.execute("SELECT COUNT(*) AS cnt FROM user_habits WHERE user_id = %s", (user_id,))
    return cursor.fetchone()['cnt']


# =====================================================
# SCORE + CHART DATA COMPUTATION
# =====================================================
def compute_period_stats(cursor, user_id, start, end):
    days = date_range_list(start, end)
    day_strs = [d.isoformat() for d in days]

    mood_rows = fetch_mood_logs(cursor, user_id, start, end)
    sleep_rows = fetch_sleep_logs(cursor, user_id, start, end)
    habit_rows = fetch_habit_logs(cursor, user_id, start, end)
    journal_rows = fetch_journal_entries(cursor, user_id, start, end)

    # ---- Mood: per-day average score + distribution ----
    mood_by_day = {}
    mood_counts = {label: 0 for label in MOOD_SCORE_MAP}
    for row in mood_rows:
        day = row['log_day'].isoformat()
        score = MOOD_SCORE_MAP.get(row['mood'])
        if score is not None:
            mood_by_day.setdefault(day, []).append(score)
        if row['mood'] in mood_counts:
            mood_counts[row['mood']] += 1

    mood_series = []
    for d in day_strs:
        scores = mood_by_day.get(d)
        mood_series.append(round(sum(scores) / len(scores)) if scores else None)

    all_mood_scores = [s for scores in mood_by_day.values() for s in scores]
    avg_mood_score = round(sum(all_mood_scores) / len(all_mood_scores)) if all_mood_scores else None

    # ---- Sleep: per-day hours + score ----
    sleep_by_day = {}
    for row in sleep_rows:
        day = row['log_date'].isoformat()
        hours = round(row['sleep_duration_minutes'] / 60, 1)
        score = sleep_score_for_log(row['sleep_duration_minutes'], row['sleep_quality'])
        sleep_by_day[day] = {'hours': hours, 'score': score}

    sleep_hours_series = [sleep_by_day.get(d, {}).get('hours') for d in day_strs]
    sleep_scores = [v['score'] for v in sleep_by_day.values() if v['score'] is not None]
    avg_sleep_score = round(sum(sleep_scores) / len(sleep_scores)) if sleep_scores else None

    # ---- Habits: consistency percent ----
    total_habits = count_active_habits(cursor, user_id)
    total_possible = total_habits * len(days)
    completed_count = sum(1 for r in habit_rows if r['completed'])
    habit_percent = round((completed_count / total_possible) * 100) if total_possible else 0

    # ---- Composite score ----
    factor_scores = {
        'mood': avg_mood_score if avg_mood_score is not None else 0,
        'sleep': avg_sleep_score if avg_sleep_score is not None else 0,
        'habits': habit_percent,
    }
    if avg_mood_score is None and avg_sleep_score is None and total_possible == 0:
        composite = 0
    else:
        composite = round(
            factor_scores['mood'] * WEIGHT_MOOD
            + factor_scores['sleep'] * WEIGHT_SLEEP
            + factor_scores['habits'] * WEIGHT_HABITS
        )

    # ---- Correlations (simple, deterministic, not AI-guessed) ----
    correlations = []

    good_sleep_days = {d for d, v in sleep_by_day.items() if v['hours'] and v['hours'] >= 7}
    poor_sleep_days = {d for d, v in sleep_by_day.items() if v['hours'] and v['hours'] < 6}
    good_sleep_moods = [s for d in good_sleep_days for s in mood_by_day.get(d, [])]
    poor_sleep_moods = [s for d in poor_sleep_days for s in mood_by_day.get(d, [])]
    if good_sleep_moods and poor_sleep_moods:
        diff = (sum(good_sleep_moods) / len(good_sleep_moods)) - (sum(poor_sleep_moods) / len(poor_sleep_moods))
        if diff >= 12:
            correlations.append({'type': 'positive', 'text': 'Your mood tends to be noticeably better on days you got 7+ hours of sleep.'})
        elif diff <= -12:
            correlations.append({'type': 'negative', 'text': 'Shorter sleep nights seem linked to lower mood the next day.'})

    journal_days = {row['entry_date'].isoformat() for row in journal_rows}
    no_journal_days = set(day_strs) - journal_days
    journal_moods = [s for d in journal_days for s in mood_by_day.get(d, [])]
    no_journal_moods = [s for d in no_journal_days for s in mood_by_day.get(d, [])]
    if journal_moods and no_journal_moods:
        diff = (sum(journal_moods) / len(journal_moods)) - (sum(no_journal_moods) / len(no_journal_moods))
        if diff >= 10:
            correlations.append({'type': 'positive', 'text': 'Days you journaled tended to have a better mood than days you didn\u2019t.'})

    fully_completed_days = set()
    if total_habits:
        completed_by_day = {}
        for r in habit_rows:
            if r['completed']:
                completed_by_day[r['log_date'].isoformat()] = completed_by_day.get(r['log_date'].isoformat(), 0) + 1
        fully_completed_days = {d for d, c in completed_by_day.items() if c >= total_habits}
    other_days = set(day_strs) - fully_completed_days
    full_habit_moods = [s for d in fully_completed_days for s in mood_by_day.get(d, [])]
    other_habit_moods = [s for d in other_days for s in mood_by_day.get(d, [])]
    if full_habit_moods and other_habit_moods:
        diff = (sum(full_habit_moods) / len(full_habit_moods)) - (sum(other_habit_moods) / len(other_habit_moods))
        if diff >= 10:
            correlations.append({'type': 'positive', 'text': 'On days you completed all your habits, your mood was noticeably higher.'})

    return {
        'factor_scores': factor_scores,
        'composite': composite,
        'trend': {
            'labels': [d.strftime('%b %d') for d in days],
            'mood_series': mood_series,
            'sleep_series': sleep_hours_series,
        },
        'mood_distribution': {
            'labels': list(MOOD_SCORE_MAP.keys()),
            'values': [mood_counts[label] for label in MOOD_SCORE_MAP],
        },
        'sleep_pattern': {
            'labels': [d.strftime('%b %d') for d in days],
            'hours': sleep_hours_series,
        },
        'habit_consistency': {
            'percent': habit_percent,
            'completed': completed_count,
            'total': total_possible,
        },
        'correlations': correlations,
        'has_any_data': bool(mood_rows or sleep_rows or habit_rows or journal_rows),
    }


# =====================================================
# SUPPORT BANNER — deterministic trigger, fixed copy
# =====================================================
def check_support_banner(cursor, user_id, today=None):
    today = today or date.today()
    window_start = today - timedelta(days=13)  # last 14 days

    cursor.execute(
        "SELECT COUNT(*) AS cnt FROM mood_logs "
        "WHERE user_id = %s AND mood IN ('Sad', 'Stressed') "
        "AND DATE(logged_at) BETWEEN %s AND %s",
        (user_id, window_start, today)
    )
    difficult_days = cursor.fetchone()['cnt']

    if difficult_days >= 8:
        return True, (
            "We've noticed a longer stretch of difficult days in your check-ins. "
            "That's worth paying attention to \u2014 if it would help, talking to "
            "someone, like a counselor, doctor, or someone you trust, is always an option."
        )
    return False, None


# =====================================================
# AI NARRATIVE — powered by Groq (see groq_client.py)
# =====================================================


def generate_ai_narrative(stats, period_label):
    prompt_data = {
        "period": period_label,
        "overall_score": stats['composite'],
        "mood_score": stats['factor_scores']['mood'],
        "sleep_score": stats['factor_scores']['sleep'],
        "habit_consistency_percent": stats['habit_consistency']['percent'],
        "mood_distribution": stats['mood_distribution'],
        "correlations": [c['text'] for c in stats['correlations']],
    }

    prompt = f"""
You are the Insights summary feature inside a wellness application called Serenity.

Write a short, warm, plain-language wellness summary based ONLY on the
already-computed statistics given below.

STRICT OUTPUT RULES:
1. Write 3-5 short sentences, nothing more.
2. Do NOT write an introduction or greeting.
3. Do NOT ask questions or offer further help.
4. Do NOT use emojis.
5. Never invent numbers that are not given to you below.
6. Never diagnose a condition or give medical advice.
7. If the stats show a difficult period, acknowledge it gently without alarm.
8. End on an encouraging, non-generic note.

Here is this period's data:
{json.dumps(prompt_data, indent=2)}

Write the summary now.
"""

    try:
        ai_response = groq_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=300,
        )
        return ai_response or None

    except AIUnavailable as e:
        print("INSIGHTS AI NARRATIVE ERROR:", e)
        return None


# =====================================================
# CACHING
# =====================================================
def get_cached_report(cursor, user_id, period, period_start):
    cursor.execute(
        "SELECT narrative, correlations_json FROM insight_reports "
        "WHERE user_id = %s AND period = %s AND period_start = %s",
        (user_id, period, period_start)
    )
    return cursor.fetchone()


def save_report_cache(cursor, user_id, period, period_start, period_end, narrative, correlations):
    cursor.execute(
        "INSERT INTO insight_reports (user_id, period, period_start, period_end, narrative, correlations_json) "
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE narrative = VALUES(narrative), "
        "correlations_json = VALUES(correlations_json), generated_at = CURRENT_TIMESTAMP",
        (user_id, period, period_start, period_end, narrative, json.dumps(correlations))
    )


# =====================================================
# BUILD THE FULL RESPONSE PAYLOAD FOR ONE PERIOD
# =====================================================
def build_insights_payload(cursor, user_id, period, force_refresh=False):
    start, end, prev_start, prev_end, label = get_period_range(period)

    stats = compute_period_stats(cursor, user_id, start, end)
    prev_stats = compute_period_stats(cursor, user_id, prev_start, prev_end)

    delta = stats['composite'] - prev_stats['composite'] if prev_stats['has_any_data'] else 0
    if not prev_stats['has_any_data']:
        delta_label = 'Not enough history yet to compare'
    elif delta > 0:
        delta_label = f'+{delta} from last {("week" if period == "weekly" else "period")}'
    elif delta < 0:
        delta_label = f'{delta} from last {("week" if period == "weekly" else "period")}'
    else:
        delta_label = 'No change from last period'

    # AI narrative: use cache unless forced to refresh or nothing cached yet
    narrative = None
    correlations = stats['correlations']

    if stats['has_any_data']:
        cached = None if force_refresh else get_cached_report(cursor, user_id, period, start)
        if cached:
            narrative = cached['narrative']
            try:
                correlations = json.loads(cached['correlations_json']) or correlations
            except (TypeError, ValueError):
                pass
        else:
            narrative = generate_ai_narrative(stats, label)
            if narrative:
                save_report_cache(cursor, user_id, period, start, end, narrative, correlations)

    show_banner, support_message = check_support_banner(cursor, user_id)

    return {
        'status': 'success',
        'period': period,
        'range_label': label,
        'score': {
            'value': stats['composite'],
            'delta': delta,
            'delta_label': delta_label,
        },
        'factors': stats['factor_scores'],
        'trend': stats['trend'],
        'mood_distribution': stats['mood_distribution'],
        'sleep_pattern': stats['sleep_pattern'],
        'habit_consistency': stats['habit_consistency'],
        'ai_narrative': narrative,
        'correlations': correlations,
        'show_support_banner': show_banner,
        'support_message': support_message,
    }


# =====================================================
# ROUTES
# =====================================================
# =====================================================
# ROUTES
# Plain functions — wired into app.py via add_url_rule
# at the bottom of this file's usage instructions, so the
# endpoint stays named "insights" (matching your existing
# url_for('insights') calls) instead of a Blueprint-prefixed name.
# =====================================================
def insights():
    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:
        payload = build_insights_payload(cursor, user_id, 'weekly')
        conn.commit()  # commits any cache writes from build_insights_payload
        return render_template('insights.html', insights_data=payload)
    finally:
        cursor.close()
        conn.close()


def insights_data():
    if 'user_id' not in session:
        return jsonify(status='error', message='Please log in again.'), 401

    user_id = session['user_id']
    period = request.args.get('period', 'weekly')
    if period not in ('daily', 'weekly', 'monthly'):
        period = 'weekly'
    force_refresh = request.args.get('refresh') == '1'

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:
        payload = build_insights_payload(cursor, user_id, period, force_refresh=force_refresh)
        conn.commit()
        return jsonify(**payload)
    except Exception as e:
        conn.rollback()
        print(f"[insights_data] error: {e}")
        return jsonify(status='error', message='Unable to load insights right now.'), 500
    finally:
        cursor.close()
        conn.close()