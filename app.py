import os
import re
import secrets
import hashlib
import traceback
import smtplib
import requests
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from datetime import datetime
from flask_wtf.csrf import CSRFProtect
from ai_analysis import analyze_journal_with_ai

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
    jsonify
)

from dotenv import load_dotenv
from werkzeug.security import check_password_hash, generate_password_hash

from db_config import get_db_connection
from insights_routes import insights, insights_data, build_insights_payload
# =========================================================
# LOAD ENVIRONMENT VARIABLES
# =========================================================
load_dotenv()
# =========================================================
# EMAIL CONFIGURATION
# =========================================================
MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")
MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_USE_TLS = os.getenv("MAIL_USE_TLS", "true").lower() == "true"
# =========================================================
# FLASK APP
# =========================================================
app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY")
csrf = CSRFProtect(app)
app.add_url_rule('/insights', 'insights', insights)
app.add_url_rule('/insights/data', 'insights_data', insights_data)
# =========================================================
# SEND PASSWORD RESET EMAIL
# =========================================================
def send_password_reset_email(recipient_email, reset_link):

    if not MAIL_USERNAME or not MAIL_PASSWORD:
        raise RuntimeError(
            "Email configuration is missing. "
            "Check MAIL_USERNAME and MAIL_PASSWORD in .env."
        )

    message = EmailMessage()

    message["Subject"] = "Reset your Serenity password"
    message["From"] = MAIL_USERNAME
    message["To"] = recipient_email

    message.set_content(
        f"""Hello,

We received a request to reset your Serenity account password.

Click the link below to choose a new password:

{reset_link}

This link will expire in 30 minutes and can only be used once.

If you did not request a password reset, you can safely ignore this email.

For your security, please do not share this link with anyone.

Regards,
Serenity
"""
    )

    with smtplib.SMTP(MAIL_SERVER, MAIL_PORT, timeout=20) as server:

        if MAIL_USE_TLS:
            server.starttls()

        server.login(
            MAIL_USERNAME,
            MAIL_PASSWORD
        )

        server.send_message(message)
# =========================================================
# LANDING PAGE
# =========================================================
@app.route("/")
def home():
    return render_template("landing.html")
# =========================================================
# LOGIN
# =========================================================

@app.route("/login", methods=["GET", "POST"])
def login():

    # -------------------------
    # GET REQUEST
    # -------------------------

    if request.method == "GET":
        return render_template("login.html")

    # -------------------------
    # GET FORM DATA
    # -------------------------

    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    remember_me = request.form.get("remember_me")

    # -------------------------
    # BASIC VALIDATION
    # -------------------------

    if not email or not password:
        flash("Please enter your email and password.", "error")
        return render_template("login.html")

    connection = None
    cursor = None

    try:

        # -------------------------
        # DATABASE CONNECTION
        # -------------------------

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # -------------------------
        # FIND USER
        # -------------------------

        cursor.execute(
            """
            SELECT
                id,
                full_name,
                email,
                password_hash,
                is_active
            FROM users
            WHERE email = %s
            LIMIT 1
            """,
            (email,)
        )

        user = cursor.fetchone()

        # -------------------------
        # USER NOT FOUND
        # -------------------------

        if not user:
            flash("Invalid email or password.", "error")
            return render_template("login.html")

        # -------------------------
        # ACCOUNT INACTIVE
        # -------------------------

        if not user["is_active"]:
            flash(
                "Your account is currently inactive. Please contact support.",
                "error"
            )
            return render_template("login.html")

        # -------------------------
        # PASSWORD CHECK
        # -------------------------

        if not check_password_hash(
            user["password_hash"],
            password
        ):
            flash("Invalid email or password.", "error")
            return render_template("login.html")

        # =================================================
        # LOGIN SUCCESSFUL
        # =================================================

        session.clear()

        session["user_id"] = user["id"]
        session["full_name"] = user["full_name"]
        session["email"] = user["email"]

        # -------------------------
        # REMEMBER ME
        # -------------------------

        session.permanent = bool(remember_me)

        # -------------------------
        # REDIRECT TO DASHBOARD
        # -------------------------

        flash(
            f"Welcome back, {user['full_name']}!",
            "success"
        )

        return redirect(url_for("dashboard"))

    except Exception as e:

        print("LOGIN ERROR:", e)

        flash(
            "Something went wrong while signing you in. Please try again.",
            "error"
        )

        return render_template("login.html")

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# DASHBOARD
# =========================================================
@app.route("/dashboard")
def dashboard():

    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    full_name = session.get("full_name", "User")

    # -------------------------
    # GREETING
    # -------------------------

    current_hour = datetime.now().hour

    if current_hour < 12:
        greeting = "Good morning"
        greeting_sub = "Start your day with a little kindness toward yourself."
    elif current_hour < 17:
        greeting = "Good afternoon"
        greeting_sub = "Take a moment to check in with yourself."
    else:
        greeting = "Good evening"
        greeting_sub = "Slow down, breathe, and give yourself some space."

    # -------------------------
    # DEFAULT VALUES
    # -------------------------

    today_mood = None
    today_sleep = None
    today_sleep_quality = None
    wellness_score = 0
    score_label = "Just Getting Started"
    journal_streak = 0
    sleep_streak = 0
    habit_streak = 0

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # -------------------------
        # GET TODAY'S LATEST MOOD
        # -------------------------

        cursor.execute(
            """
            SELECT mood
            FROM mood_logs
            WHERE user_id = %s
              AND DATE(logged_at) = CURDATE()
            ORDER BY logged_at DESC
            LIMIT 1
            """,
            (session["user_id"],)
        )

        mood_result = cursor.fetchone()

        if mood_result:
            today_mood = mood_result["mood"]
                # Streaks
        journal_streak = calculate_activity_streak(cursor, session["user_id"], "journal_entries", "entry_date")
        sleep_streak = calculate_activity_streak(cursor, session["user_id"], "sleep_logs", "log_date")

        cursor.execute("SELECT habit_id FROM user_habits WHERE user_id = %s", (session["user_id"],))
        habit_ids = [row["habit_id"] for row in cursor.fetchall()]
        habit_streak = max(
            [calculate_habit_streak(cursor, session["user_id"], hid) for hid in habit_ids],
            default=0
        )

        # Wellness score
        wellness_score, score_label = calculate_wellness_score(cursor, session["user_id"])
    except Exception as e:

        import traceback
        with open("dashboard_error_log.txt", "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())

        print("DASHBOARD ERROR:", e)

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()

    return render_template(
        "dashboard.html",
        username=full_name,
        full_name=full_name,
        greeting=greeting,
        greeting_sub=greeting_sub,
        today_mood=today_mood,
        today_sleep=today_sleep,
        today_sleep_quality=today_sleep_quality,
        wellness_score=wellness_score,
        score_label=score_label,
        journal_streak=journal_streak,
        sleep_streak=sleep_streak,
        habit_streak=habit_streak
    )


@app.route("/save_mood", methods=["POST"])
def save_mood():

    # -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please sign in again."
        }), 401

    # -------------------------
    # GET MOOD
    # -------------------------

    mood = request.form.get("mood", "").strip()

    allowed_moods = [
        "Happy",
        "Calm",
        "Neutral",
        "Sad",
        "Stressed"
    ]

    # -------------------------
    # VALIDATE MOOD
    # -------------------------

    if mood not in allowed_moods:
        return jsonify({
            "status": "error",
            "message": "Invalid mood selected."
        }), 400

    connection = None
    cursor = None

    try:

        # -------------------------
        # DATABASE CONNECTION
        # -------------------------

        connection = get_db_connection()
        cursor = connection.cursor()

        # -------------------------
        # SAVE MOOD
        # -------------------------

        cursor.execute(
            """
            INSERT INTO mood_logs
            (user_id, mood)
            VALUES (%s, %s)
            """,
            (
                session["user_id"],
                mood
            )
        )

        connection.commit()

        # -------------------------
        # SUCCESS RESPONSE
        # -------------------------

        return jsonify({
            "status": "success",
            "message": f"Your mood was recorded as {mood}.",
            "mood": mood
        })

    except Exception as e:

        print("SAVE MOOD ERROR:", e)

        if connection:
            connection.rollback()

        return jsonify({
            "status": "error",
            "message": "Unable to save your mood. Please try again."
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()

@app.route("/sleep-tracker")
def sleep_tracker():

    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    return render_template("sleep_tracker.html")
@app.route("/save_sleep", methods=["POST"])
def save_sleep():

    # -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please sign in again."
        }), 401

    # -------------------------
    # GET FORM DATA
    # -------------------------

    sleep_start = request.form.get("sleepStart", "").strip()
    wake_time = request.form.get("wakeTime", "").strip()
    duration = request.form.get("sleepDurationMinutes", "").strip()
    sleep_quality = request.form.get("sleepQuality", "").strip()

    # -------------------------
    # VALIDATE DATA
    # -------------------------

    allowed_quality = [
        "Restless",
        "Light Sleep",
        "Balanced",
        "Restorative",
        "Deep Sleep"
    ]

    if not sleep_start or not wake_time:
        return jsonify({
            "status": "error",
            "message": "Please select both sleep and wake times."
        }), 400

    if sleep_quality not in allowed_quality:
        return jsonify({
            "status": "error",
            "message": "Please select your sleep quality."
        }), 400

    try:
        duration = int(duration)
    except (ValueError, TypeError):
        return jsonify({
            "status": "error",
            "message": "Invalid sleep duration."
        }), 400

    if duration <= 0 or duration > 24 * 60:
        return jsonify({
            "status": "error",
            "message": "Invalid sleep duration."
        }), 400

    connection = None
    cursor = None

    try:

        # -------------------------
        # DATABASE CONNECTION
        # -------------------------

        connection = get_db_connection()
        cursor = connection.cursor()

        # -------------------------
        # SAVE SLEEP
        # -------------------------

        cursor.execute(
            """
            INSERT INTO sleep_logs
            (
                user_id,
                sleep_start,
                wake_time,
                sleep_duration_minutes,
                sleep_quality,
                log_date
            )
            VALUES (%s, %s, %s, %s, %s, CURDATE())
            """,
            (
                session["user_id"],
                sleep_start,
                wake_time,
                duration,
                sleep_quality
            )
        )

        connection.commit()

        # -------------------------
        # SUCCESS RESPONSE
        # -------------------------

        return jsonify({
            "status": "success",
            "message": "Sleep recorded successfully.",
            "duration": duration,
            "quality": sleep_quality
        })

    except Exception as e:

        print("SAVE SLEEP ERROR:", e)

        if connection:
            connection.rollback()

        return jsonify({
            "status": "error",
            "message": "Unable to save your sleep data. Please try again."
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# JOURNAL
# =========================================================
@app.route("/journal")
def journal():
    # -------------------------
    # LOGIN CHECK
    # -------------------------
    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    connection = None
    cursor = None

    journals = []

    try:

        # -------------------------
        # DATABASE CONNECTION
        # -------------------------

        connection = get_db_connection()
        cursor = connection.cursor()

        # -------------------------
        # GET USER'S JOURNAL ENTRIES
        # -------------------------

        cursor.execute(
            """
            SELECT
                id,
                title,
                journal_text,
                sentiment,
                emotion,
                ai_summary,
                created_at
            FROM journal_entries
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (session["user_id"],)
        )

        journals = cursor.fetchall()

    except Exception as e:

        print("JOURNAL ERROR:", e)

        flash(
            "Unable to load your journal entries. Please try again.",
            "error"
        )

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()

    return render_template(
        "journal.html",
        journals=journals,
        editing=False
    )
# =========================================================
# JOURNAL DETAIL
# =========================================================
@app.route("/journal/<int:journal_id>")
def journal_detail(journal_id):
# -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    connection = None
    cursor = None

    try:

        # -------------------------
        # DATABASE CONNECTION
        # -------------------------

        connection = get_db_connection()
        cursor = connection.cursor()

        # -------------------------
        # GET JOURNAL ENTRY
        #
        # IMPORTANT:
        # We also check user_id so one
        # user cannot access another
        # user's journal by changing
        # the URL.
        # -------------------------

        cursor.execute(
            """
            SELECT
                id,
                title,
                journal_text,
                sentiment,
                emotion,
                ai_summary,
                created_at
            FROM journal_entries
            WHERE id = %s
              AND user_id = %s
            LIMIT 1
            """,
            (
                journal_id,
                session["user_id"]
            )
        )

        journal_entry = cursor.fetchone()

        # -------------------------
        # ENTRY NOT FOUND
        # -------------------------

        if not journal_entry:

            flash(
                "Journal entry not found.",
                "error"
            )

            return redirect(url_for("journal"))

        # -------------------------
        # SHOW DETAIL PAGE
        # -------------------------

        return render_template(
            "journal_detail.html",
            journal=journal_entry
        )

    except Exception as e:

        print("JOURNAL DETAIL ERROR:", e)

        flash(
            "Unable to open this journal entry. Please try again.",
            "error"
        )

        return redirect(url_for("journal"))

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# SAVE JOURNAL ENTRY
# =========================================================
@app.route("/save_journal", methods=["POST"])
def save_journal():

    # -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please sign in again."
        }), 401

    # -------------------------
    # GET FORM DATA
    # -------------------------

    title = request.form.get("title", "").strip()
    journal_text = request.form.get("journal_text", "").strip()
    emotion = request.form.get("emotion", "").strip()
    journal_id = request.form.get("journal_id", "").strip()

    # -------------------------
    # VALIDATION
    # -------------------------

    if not journal_text:
        return jsonify({
            "status": "error",
            "message": "Please write something in your journal."
        }), 400

    # -------------------------
    # SIMPLE SENTIMENT ANALYSIS
    # -------------------------

    positive_words = [
        "happy",
        "good",
        "great",
        "excited",
        "peaceful",
        "calm",
        "love",
        "success"
    ]

    negative_words = [
        "sad",
        "stress",
        "stressed",
        "angry",
        "lonely",
        "tired",
        "anxious",
        "worried"
    ]

    text_lower = journal_text.lower()

    positive_score = sum(
        1 for word in positive_words
        if word in text_lower
    )

    negative_score = sum(
        1 for word in negative_words
        if word in text_lower
    )

    if positive_score > negative_score:
        sentiment = "Positive"

    elif negative_score > positive_score:
        sentiment = "Negative"

    else:
        sentiment = "Neutral"

    # -------------------------
    # EMOTION DETECTION
    # -------------------------

    if any(word in text_lower for word in [
        "stress",
        "stressed",
        "anxious",
        "worried"
    ]):
        detected_emotion = "Stress"

    elif any(word in text_lower for word in [
        "sad",
        "lonely",
        "cry",
        "crying"
    ]):
        detected_emotion = "Sad"

    elif any(word in text_lower for word in [
        "happy",
        "excited",
        "joy",
        "great"
    ]):
        detected_emotion = "Happy"

    elif any(word in text_lower for word in [
        "angry",
        "anger",
        "frustrated",
        "frustration"
    ]):
        detected_emotion = "Anger"

    elif any(word in text_lower for word in [
        "calm",
        "peaceful",
        "relaxed"
    ]):
        detected_emotion = "Calm"

    else:
        detected_emotion = emotion if emotion else "Neutral"

    # -------------------------
    # DATABASE
    # -------------------------

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor()

        # =================================================
        # EDIT EXISTING JOURNAL
        # =================================================

        if journal_id:

            cursor.execute(
                """
                UPDATE journal_entries
                SET
                    title = %s,
                    journal_text = %s,
                    sentiment = %s,
                    emotion = %s
                WHERE id = %s
                  AND user_id = %s
                """,
                (
                    title if title else "My Journal",
                    journal_text,
                    sentiment,
                    detected_emotion,
                    journal_id,
                    session["user_id"]
                )
            )

            if cursor.rowcount != 1:
                connection.rollback()

                return jsonify({
                    "status": "error",
                    "message": "Journal entry not found."
                }), 404

            connection.commit()

            # -------------------------
            # AI ANALYSIS
            # -------------------------

            ai_summary = analyze_journal_with_ai(journal_text)

            if ai_summary:

                cursor.execute(
                    """
                    UPDATE journal_entries
                    SET ai_summary = %s
                    WHERE id = %s
                      AND user_id = %s
                    """,
                    (
                        ai_summary,
                        journal_id,
                        session["user_id"]
                    )
                )

                connection.commit()

            return jsonify({
                "status": "success",
                "message": "Your journal entry was updated successfully.",
                "sentiment": sentiment,
                "emotion": detected_emotion
            })

        # =================================================
        # CREATE NEW JOURNAL
        # =================================================

        cursor.execute(
            """
            INSERT INTO journal_entries
            (
                user_id,
                title,
                journal_text,
                sentiment,
                emotion,
                ai_summary,
                entry_date
            )
            VALUES (%s, %s, %s, %s, %s, %s, CURDATE())
            """,
            (
                session["user_id"],
                title if title else "My Journal",
                journal_text,
                sentiment,
                detected_emotion,
                None
            )
        )

        # Get the newly created journal ID
        new_journal_id = cursor.lastrowid

        # Save journal BEFORE AI processing
        connection.commit()

        # -------------------------
        # AI ANALYSIS
        # -------------------------

        ai_summary = analyze_journal_with_ai(journal_text)

        if ai_summary:

            cursor.execute(
                """
                UPDATE journal_entries
                SET ai_summary = %s
                WHERE id = %s
                  AND user_id = %s
                """,
                (
                    ai_summary,
                    new_journal_id,
                    session["user_id"]
                )
            )

            connection.commit()

        return jsonify({
            "status": "success",
            "message": "Your journal entry was saved successfully.",
            "sentiment": sentiment,
            "emotion": detected_emotion
        })

    except Exception as e:

        print("SAVE JOURNAL ERROR:", e)

        if connection:
            connection.rollback()

        return jsonify({
            "status": "error",
            "message": "Unable to save your journal entry. Please try again."
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# EDIT JOURNAL
# =========================================================
@app.route("/journal/<int:journal_id>/edit")
def edit_journal(journal_id):

    # -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor()

        # -------------------------
        # GET ONLY CURRENT USER'S ENTRY
        # -------------------------

        cursor.execute(
            """
            SELECT
                id,
                title,
                journal_text,
                sentiment,
                emotion,
                ai_summary,
                created_at
            FROM journal_entries
            WHERE id = %s
              AND user_id = %s
            LIMIT 1
            """,
            (
                journal_id,
                session["user_id"]
            )
        )

        journal_entry = cursor.fetchone()

        if not journal_entry:

            flash(
                "Journal entry not found.",
                "error"
            )

            return redirect(url_for("journal"))

        # -------------------------
        # LOAD JOURNAL PAGE
        # IN EDIT MODE
        # -------------------------

        return render_template(
            "journal.html",
            journals=[],
            journal=journal_entry,
            editing=True
        )

    except Exception as e:

        print("EDIT JOURNAL ERROR:", e)

        flash(
            "Unable to edit this journal entry. Please try again.",
            "error"
        )

        return redirect(url_for("journal"))

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# DELETE JOURNAL
# =========================================================
@app.route("/journal/<int:journal_id>/delete", methods=["POST"])
def delete_journal(journal_id):

    # -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor()

        # -------------------------
        # DELETE ONLY CURRENT
        # USER'S ENTRY
        # -------------------------

        cursor.execute(
            """
            DELETE FROM journal_entries
            WHERE id = %s
              AND user_id = %s
            """,
            (
                journal_id,
                session["user_id"]
            )
        )

        # -------------------------
        # CHECK WHETHER ENTRY EXISTED
        # -------------------------

        if cursor.rowcount != 1:

            connection.rollback()

            flash(
                "Journal entry not found.",
                "error"
            )

            return redirect(url_for("journal"))

        connection.commit()

        flash(
            "Journal entry deleted successfully.",
            "success"
        )

        return redirect(url_for("journal"))

    except Exception as e:

        print("DELETE JOURNAL ERROR:", e)

        if connection:
            connection.rollback()

        flash(
            "Unable to delete your journal entry. Please try again.",
            "error"
        )

        return redirect(url_for("journal"))

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
from flask import request, jsonify, render_template, session
from datetime import date
import mysql.connector
def calculate_habit_streak(cursor, user_id, habit_id):

    streak = 0
    current_date = date.today()

    while True:

        cursor.execute("""
            SELECT completed
            FROM habit_logs
            WHERE user_id = %s
              AND habit_id = %s
              AND log_date = %s
            LIMIT 1
        """, (
            user_id,
            habit_id,
            current_date
        ))

        row = cursor.fetchone()

        if not row or not row["completed"]:
            break

        streak += 1

        current_date -= timedelta(days=1)

    return streak
def calculate_activity_streak(cursor, user_id, table, date_column, is_datetime=False):
    """Counts consecutive days (ending today) with at least one row for this user."""
    streak = 0
    current_date = date.today()
    date_expr = f"DATE({date_column})" if is_datetime else date_column

    while True:
        cursor.execute(f"""
            SELECT 1 FROM {table}
            WHERE user_id = %s AND {date_expr} = %s
            LIMIT 1
        """, (user_id, current_date))

        if not cursor.fetchone():
            break

        streak += 1
        current_date -= timedelta(days=1)

    return streak


MOOD_SCORES = {"Happy": 100, "Calm": 85, "Neutral": 60, "Sad": 35, "Stressed": 20}
SLEEP_QUALITY_SCORES = {"Deep Sleep": 100, "Restorative": 85, "Balanced": 65, "Light Sleep": 40, "Restless": 20}


def calculate_wellness_score(cursor, user_id):
    """Composite 0-100 score from the last 7 days: mood 30%, sleep 25%, habits 25%, engagement 20%."""
    today = date.today()
    week_ago = today - timedelta(days=6)

    # Mood
    cursor.execute("""
        SELECT mood FROM mood_logs
        WHERE user_id = %s AND DATE(logged_at) BETWEEN %s AND %s
    """, (user_id, week_ago, today))
    moods = cursor.fetchall()
    mood_score = (
        sum(MOOD_SCORES.get(m["mood"], 60) for m in moods) / len(moods)
        if moods else 60
    )

    # Sleep
    cursor.execute("""
        SELECT sleep_quality FROM sleep_logs
        WHERE user_id = %s AND log_date BETWEEN %s AND %s
    """, (user_id, week_ago, today))
    sleeps = cursor.fetchall()
    sleep_score = (
        sum(SLEEP_QUALITY_SCORES.get(s["sleep_quality"], 60) for s in sleeps) / len(sleeps)
        if sleeps else 60
    )

    # Habits — completion rate over the last 7 days
    cursor.execute("""
        SELECT COUNT(*) AS total, SUM(completed) AS done
        FROM habit_logs
        WHERE user_id = %s AND log_date BETWEEN %s AND %s
    """, (user_id, week_ago, today))
    habit_row = cursor.fetchone()
    habit_score = (
        float(habit_row["done"] or 0) / float(habit_row["total"]) * 100
        if habit_row and habit_row["total"] else 60
    )

    # Engagement — distinct days with a journal entry or a companion chat
    cursor.execute("""
        SELECT COUNT(DISTINCT d) AS c FROM (
            SELECT entry_date AS d FROM journal_entries
            WHERE user_id = %s AND entry_date BETWEEN %s AND %s
            UNION
            SELECT DATE(cm.created_at) AS d
            FROM companion_messages cm
            JOIN companion_conversations cc ON cm.conversation_id = cc.id
            WHERE cc.user_id = %s AND DATE(cm.created_at) BETWEEN %s AND %s
        ) AS activity_days
    """, (user_id, week_ago, today, user_id, week_ago, today))
    engagement_days = cursor.fetchone()["c"] or 0
    engagement_score = min(7, engagement_days) / 7 * 100

    score = round(
        mood_score * 0.30 +
        sleep_score * 0.25 +
        habit_score * 0.25 +
        engagement_score * 0.20
    )
    score = max(0, min(100, score))

    if score >= 85:
        label = "Excellent Progress"
    elif score >= 70:
        label = "Great Progress"
    elif score >= 50:
        label = "Steady Progress"
    elif score >= 30:
        label = "Needs Attention"
    else:
        label = "Take It Easy Today"

    return score, label
# ============================================================
# HABIT TRACKER PAGE
# ============================================================
@app.route("/habit-tracker")
def habit_tracker():

    if "user_id" not in session:
        return redirect(url_for("login"))

    user_id = session["user_id"]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:

        cursor.execute("""
            SELECT
                uh.id AS user_habit_id,
                hm.id AS habit_id,
                hm.habit_name,
                hm.icon,
                hm.owner_user_id
            FROM user_habits uh
            JOIN habit_master hm
                ON uh.habit_id = hm.id
            WHERE uh.user_id = %s
            ORDER BY uh.id
        """, (user_id,))

        rows = cursor.fetchall()

        user_habits = []

        for row in rows:

            habit_id = row["habit_id"]

            # Today's completion
            cursor.execute("""
                SELECT completed
                FROM habit_logs
                WHERE user_id = %s
                  AND habit_id = %s
                  AND log_date = CURDATE()
                LIMIT 1
            """, (user_id, habit_id))

            today = cursor.fetchone()

            completed_today = (
                bool(today["completed"])
                if today else False
            )

            # Current streak
            streak = calculate_habit_streak(
                cursor,
                user_id,
                habit_id
            )

            # Last 7 days
            week = []

            for days_ago in range(6, -1, -1):

                check_date = (
                    date.today() -
                    timedelta(days=days_ago)
                )

                cursor.execute("""
                    SELECT completed
                    FROM habit_logs
                    WHERE user_id = %s
                      AND habit_id = %s
                      AND log_date = %s
                    LIMIT 1
                """, (
                    user_id,
                    habit_id,
                    check_date
                ))

                result = cursor.fetchone()

                week.append(
                    bool(result["completed"])
                    if result else False
                )

            user_habits.append({
                "id": row["user_habit_id"],
                "name": row["habit_name"],
                "icon": row["icon"] or "🎯",
                "streak": streak,
                "completed_today": completed_today,
                "is_custom": row["owner_user_id"] is not None,
                "week": week
            })

        # Predefined habits
        cursor.execute("""
            SELECT
                id,
                habit_name,
                icon
            FROM habit_master
            WHERE owner_user_id IS NULL
            ORDER BY id
        """)

        catalog_rows = cursor.fetchall()

        preset_habits = [
            {
                "id": str(row["id"]),
                "name": row["habit_name"],
                "icon": row["icon"] or "🎯"
            }
            for row in catalog_rows
        ]

        return render_template(
            "habit_tracker.html",
            user_habits=user_habits,
            preset_habits=preset_habits
        )

    finally:
        cursor.close()
        conn.close()
@app.route("/save_habits", methods=["POST"])
def save_habits():

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please login first."
        }), 401

    user_id = session["user_id"]

    data = request.get_json()

    if not data:
        return jsonify({
            "status": "error",
            "message": "Invalid request."
        }), 400

    habits = data.get("habits", [])

    if not habits:
        return jsonify({
            "status": "error",
            "message": "No habits selected."
        }), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:

        saved_habits = []

        for habit in habits:

            name = (habit.get("name") or "").strip()
            icon = habit.get("icon") or "🎯"
            is_custom = bool(habit.get("is_custom"))

            if not name:
                continue

            # -----------------------------
            # CUSTOM HABIT
            # -----------------------------
            if is_custom:

                cursor.execute("""
                    SELECT id
                    FROM habit_master
                    WHERE owner_user_id = %s
                      AND LOWER(habit_name) = LOWER(%s)
                    LIMIT 1
                """, (
                    user_id,
                    name
                ))

                existing = cursor.fetchone()

                if existing:
                    habit_id = existing["id"]

                else:

                    cursor.execute("""
                        INSERT INTO habit_master
                        (
                            habit_name,
                            icon,
                            owner_user_id
                        )
                        VALUES (%s, %s, %s)
                    """, (
                        name,
                        icon,
                        user_id
                    ))

                    habit_id = cursor.lastrowid

            # -----------------------------
            # PREDEFINED HABIT
            # -----------------------------
            else:

                # Find predefined habit by name.
                # This avoids using "water", "read",
                # etc. as integer database IDs.
                cursor.execute("""
                    SELECT id, habit_name, icon
                    FROM habit_master
                    WHERE owner_user_id IS NULL
                      AND LOWER(habit_name) = LOWER(%s)
                    LIMIT 1
                """, (name,))

                existing = cursor.fetchone()

                if not existing:
                    continue

                habit_id = existing["id"]
                name = existing["habit_name"]
                icon = existing["icon"] or icon

            # -----------------------------
            # USER HABIT
            # -----------------------------

            cursor.execute("""
                SELECT id
                FROM user_habits
                WHERE user_id = %s
                  AND habit_id = %s
                LIMIT 1
            """, (
                user_id,
                habit_id
            ))

            existing_user_habit = cursor.fetchone()

            if existing_user_habit:

                user_habit_id = existing_user_habit["id"]

            else:

                cursor.execute("""
                    INSERT INTO user_habits
                    (
                        user_id,
                        habit_id
                    )
                    VALUES (%s, %s)
                """, (
                    user_id,
                    habit_id
                ))

                user_habit_id = cursor.lastrowid

            saved_habits.append({
                "id": user_habit_id,
                "name": name,
                "icon": icon,
                "streak": 0,
                "completed_today": False,
                "is_custom": is_custom,
                "week": [
                    False, False, False,
                    False, False, False, False
                ]
            })

        conn.commit()

        return jsonify({
            "status": "success",
            "habits": saved_habits
        })

    except Exception as e:

        conn.rollback()

        print("SAVE HABITS ERROR:", e)

        return jsonify({
            "status": "error",
            "message": "Unable to save habits."
        }), 500

    finally:
        cursor.close()
        conn.close()
@app.route("/toggle_habit", methods=["POST"])
def toggle_habit():

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please login first."
        }), 401

    user_id = session["user_id"]

    user_habit_id = request.form.get("habit_id")

    try:
        user_habit_id = int(user_habit_id)
    except (ValueError, TypeError):

        return jsonify({
            "status": "error",
            "message": "Invalid habit ID."
        }), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:

        # Verify that this habit belongs to this user
        cursor.execute("""
            SELECT habit_id
            FROM user_habits
            WHERE id = %s
              AND user_id = %s
            LIMIT 1
        """, (
            user_habit_id,
            user_id
        ))

        user_habit = cursor.fetchone()

        if not user_habit:

            return jsonify({
                "status": "error",
                "message": "Habit not found."
            }), 404

        habit_id = user_habit["habit_id"]

        # Check today's log
        cursor.execute("""
            SELECT id, completed
            FROM habit_logs
            WHERE user_id = %s
              AND habit_id = %s
              AND log_date = CURDATE()
            LIMIT 1
        """, (
            user_id,
            habit_id
        ))

        log = cursor.fetchone()

        if log:

            new_status = 0 if log["completed"] else 1

            cursor.execute("""
                UPDATE habit_logs
                SET completed = %s
                WHERE id = %s
            """, (
                new_status,
                log["id"]
            ))

        else:

            new_status = 1

            cursor.execute("""
                INSERT INTO habit_logs
                (
                    user_id,
                    habit_id,
                    completed,
                    log_date
                )
                VALUES (%s, %s, %s, CURDATE())
            """, (
                user_id,
                habit_id,
                new_status
            ))

        streak = calculate_habit_streak(
            cursor,
            user_id,
            habit_id
        )

        conn.commit()

        return jsonify({
            "status": "success",
            "completed": bool(new_status),
            "streak": streak
        })

    except Exception as e:

        conn.rollback()

        print("TOGGLE HABIT ERROR:", e)

        return jsonify({
            "status": "error",
            "message": "Unable to update habit."
        }), 500

    finally:
        cursor.close()
        conn.close()
@app.route("/delete_habit", methods=["POST"])
def delete_habit():

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please login first."
        }), 401

    user_id = session["user_id"]

    user_habit_id = request.form.get("habit_id")

    try:
        user_habit_id = int(user_habit_id)
    except (ValueError, TypeError):

        return jsonify({
            "status": "error",
            "message": "Invalid habit ID."
        }), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:

        # Get the real habit
        cursor.execute("""
            SELECT
                uh.habit_id,
                hm.owner_user_id
            FROM user_habits uh
            JOIN habit_master hm
                ON uh.habit_id = hm.id
            WHERE uh.id = %s
              AND uh.user_id = %s
            LIMIT 1
        """, (
            user_habit_id,
            user_id
        ))

        habit = cursor.fetchone()

        if not habit:

            return jsonify({
                "status": "error",
                "message": "Habit not found."
            }), 404

        habit_id = habit["habit_id"]
        owner_user_id = habit["owner_user_id"]

        # Delete this user's history
        cursor.execute("""
            DELETE FROM habit_logs
            WHERE user_id = %s
              AND habit_id = %s
        """, (
            user_id,
            habit_id
        ))

        # Remove habit from user's list
        cursor.execute("""
            DELETE FROM user_habits
            WHERE id = %s
              AND user_id = %s
        """, (
            user_habit_id,
            user_id
        ))

        # Delete custom habit from master table
        # only if THIS user created it.
        if owner_user_id == user_id:

            cursor.execute("""
                DELETE FROM habit_master
                WHERE id = %s
                  AND owner_user_id = %s
            """, (
                habit_id,
                user_id
            ))

        conn.commit()

        return jsonify({
            "status": "success"
        })

    except Exception as e:

        conn.rollback()

        print("DELETE HABIT ERROR:", e)

        return jsonify({
            "status": "error",
            "message": "Unable to delete habit."
        }), 500

    finally:
        cursor.close()
        conn.close()
@app.route("/calm-corner")
def calm_corner():
    # Only logged-in users can access Calm Corner
    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    return render_template(
        "calm_corner.html",
        full_name=session.get("full_name", "User")
    )

@app.route("/ai-companion")
def ai_companion():

    if "user_id" not in session:
        flash("Please sign in to continue.", "warning")
        return redirect(url_for("login"))

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # Get user's conversations
        cursor.execute(
            """
            SELECT id, title, updated_at
            FROM companion_conversations
            WHERE user_id = %s
            ORDER BY updated_at DESC
            """,
            (session["user_id"],)
        )

        conversations = cursor.fetchall()

        return render_template(
            "ai_companion.html",
            conversations=conversations,
            active_conversation_id=None,
            active_conversation_title="AI Companion",
            messages=[]
        )

    except Exception as e:

        print("AI COMPANION PAGE ERROR:", e)

        flash(
            "Unable to load AI Companion. Please try again.",
            "error"
        )

        return redirect(url_for("dashboard"))

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
@app.route("/send_message", methods=["POST"])
def send_message():

    # -------------------------
    # LOGIN CHECK
    # -------------------------

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please sign in again."
        }), 401

    # -------------------------
    # GET JSON DATA
    # -------------------------

    data = request.get_json(silent=True) or {}

    message = data.get("message", "").strip()
    conversation_id = data.get("conversation_id")

    # -------------------------
    # VALIDATION
    # -------------------------

    if not message:
        return jsonify({
            "status": "error",
            "message": "Please enter a message."
        }), 400

    # Prevent extremely large requests
    if len(message) > 5000:
        return jsonify({
            "status": "error",
            "message": "Message is too long. Please keep it under 5000 characters."
        }), 400

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        user_id = session["user_id"]

        # =================================================
        # CREATE NEW CONVERSATION
        # =================================================

        if not conversation_id:

            # Create a short conversation title
            title = message.strip()

            if len(title) > 42:
                title = title[:42].strip() + "…"

            cursor.execute(
                """
                INSERT INTO companion_conversations
                (
                    user_id,
                    title
                )
                VALUES (%s, %s)
                """,
                (
                    user_id,
                    title if title else "New Conversation"
                )
            )

            conversation_id = cursor.lastrowid

            new_conversation = True

        else:

            # =================================================
            # VERIFY CONVERSATION BELONGS TO CURRENT USER
            # =================================================

            cursor.execute(
                """
                SELECT id, title
                FROM companion_conversations
                WHERE id = %s
                  AND user_id = %s
                LIMIT 1
                """,
                (
                    conversation_id,
                    user_id
                )
            )

            conversation = cursor.fetchone()

            if not conversation:
                return jsonify({
                    "status": "error",
                    "message": "Conversation not found."
                }), 404

            new_conversation = False

        # =================================================
        # SAVE USER MESSAGE
        # =================================================

        cursor.execute(
            """
            INSERT INTO companion_messages
            (
                conversation_id,
                role,
                content
            )
            VALUES (%s, %s, %s)
            """,
            (
                conversation_id,
                "user",
                message
            )
        )

        # =================================================
        # GET PREVIOUS MESSAGES
        # =================================================

        cursor.execute(
            """
            SELECT role, content
            FROM companion_messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC
            """,
            (conversation_id,)
        )

        messages = cursor.fetchall()

        # =================================================
        # BUILD OLLAMA PROMPT
        # =================================================

        conversation_text = ""

        for msg in messages:
            if msg["role"] == "user":
                conversation_text += (
                    "User: " + msg["content"] + "\n"
                )
            else:
                conversation_text += (
                    "Serenity: " + msg["content"] + "\n"
                )

        prompt = f"""
You are Serenity, a gentle and supportive AI wellness companion.

Your purpose is to provide friendly, empathetic and practical
supportive conversation.

Important rules:

- Be warm, calm and respectful.
- Listen to what the user is saying.
- Respond naturally and conversationally.
- Keep responses reasonably short.
- Do not diagnose mental health conditions.
- Do not claim to be a doctor, therapist or medical professional.
- Do not provide medical advice.
- Do not judge the user.
- Do not repeatedly say "I'm here for you."
- Do not ask unnecessary questions.
- Do not use excessive emojis.
- If the user is stressed, nervous, worried or overwhelmed,
  you may suggest a suitable activity from Serenity's Calm Corner,
  such as breathing exercises, meditation, relaxation or calming music.
- If the user is discussing something unrelated to wellness,
  answer naturally but remain supportive.

Conversation:

{conversation_text}

Serenity:
"""

        # =================================================
        # CALL OLLAMA
        # =================================================

        ollama_response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "gemma3:1b",
                "prompt": prompt,
                "stream": False
            },
            timeout=60
        )

        ollama_response.raise_for_status()

        result = ollama_response.json()

        reply = result.get("response", "").strip()

        if not reply:

            connection.rollback()

            return jsonify({
                "status": "error",
                "message": "The AI could not generate a response."
            }), 500

        # =================================================
        # SAVE AI RESPONSE
        # =================================================

        cursor.execute(
            """
            INSERT INTO companion_messages
            (
                conversation_id,
                role,
                content
            )
            VALUES (%s, %s, %s)
            """,
            (
                conversation_id,
                "assistant",
                reply
            )
        )

        # =================================================
        # UPDATE CONVERSATION TIME
        # =================================================

        cursor.execute(
            """
            UPDATE companion_conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
              AND user_id = %s
            """,
            (
                conversation_id,
                user_id
            )
        )

        connection.commit()

        # =================================================
        # RESPONSE TO JAVASCRIPT
        # =================================================

        response_data = {
            "status": "success",
            "reply": reply,
            "conversation_id": conversation_id
        }

        if new_conversation:

            cursor.execute(
                """
                SELECT title
                FROM companion_conversations
                WHERE id = %s
                  AND user_id = %s
                LIMIT 1
                """,
                (
                    conversation_id,
                    user_id
                )
            )

            conversation = cursor.fetchone()

            response_data["title"] = (
                conversation["title"]
                if conversation
                else "New Conversation"
            )

        return jsonify(response_data)

    except requests.exceptions.RequestException as e:

        print("OLLAMA ERROR:", e)

        if connection:
            connection.rollback()

        return jsonify({
            "status": "error",
            "message": "AI Companion is currently unavailable. Please make sure Ollama is running."
        }), 503

    except Exception as e:

        print("SEND MESSAGE ERROR:", e)

        if connection:
            connection.rollback()

        return jsonify({
            "status": "error",
            "message": "Unable to process your message. Please try again."
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
@app.route("/get_conversation_messages")
def get_conversation_messages():

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please sign in again."
        }), 401

    conversation_id = request.args.get("conversation_id")

    if not conversation_id:
        return jsonify({
            "status": "error",
            "message": "Conversation ID is required."
        }), 400

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        user_id = session["user_id"]

        # =================================================
        # VERIFY CONVERSATION OWNERSHIP
        # =================================================

        cursor.execute(
            """
            SELECT id, title
            FROM companion_conversations
            WHERE id = %s
              AND user_id = %s
            LIMIT 1
            """,
            (
                conversation_id,
                user_id
            )
        )

        conversation = cursor.fetchone()

        if not conversation:

            return jsonify({
                "status": "error",
                "message": "Conversation not found."
            }), 404

        # =================================================
        # GET MESSAGES
        # =================================================

        cursor.execute(
            """
            SELECT role, content, created_at
            FROM companion_messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC
            """,
            (conversation_id,)
        )

        messages = cursor.fetchall()

        return jsonify({
            "status": "success",
            "title": conversation["title"],
            "messages": [
                {
                    "role": msg["role"],
                    "content": msg["content"]
                }
                for msg in messages
            ]
        })

    except Exception as e:

        print("GET CONVERSATION ERROR:", e)

        return jsonify({
            "status": "error",
            "message": "Unable to load the conversation."
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
@app.route("/delete_conversation", methods=["POST"])
def delete_conversation():

    if "user_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Please sign in again."
        }), 401

    conversation_id = request.form.get("conversation_id")

    if not conversation_id:
        return jsonify({
            "status": "error",
            "message": "Conversation ID is required."
        }), 400

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor()

        # Because companion_messages uses
        # ON DELETE CASCADE, deleting the conversation
        # also deletes its messages.

        cursor.execute(
            """
            DELETE FROM companion_conversations
            WHERE id = %s
              AND user_id = %s
            """,
            (
                conversation_id,
                session["user_id"]
            )
        )

        if cursor.rowcount != 1:

            connection.rollback()

            return jsonify({
                "status": "error",
                "message": "Conversation not found."
            }), 404

        connection.commit()

        return jsonify({
            "status": "success"
        })

    except Exception as e:

        print("DELETE CONVERSATION ERROR:", e)

        if connection:
            connection.rollback()

        return jsonify({
            "status": "error",
            "message": "Unable to delete the conversation."
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# FORGOT PASSWORD
# =========================================================

@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():

    if request.method == "GET":
        return render_template("forgot_password.html")

    email = request.form.get("email", "").strip().lower()

    # -----------------------------------------------------
    # BASIC VALIDATION
    # -----------------------------------------------------

    if not email:
        flash("Please enter your email address.", "error")
        return render_template("forgot_password.html")

    email_pattern = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"

    if not re.match(email_pattern, email):
        flash("Please enter a valid email address.", "error")
        return render_template("forgot_password.html")

    connection = None
    cursor = None

    try:

        # -------------------------------------------------
        # DATABASE CONNECTION
        # -------------------------------------------------

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # -------------------------------------------------
        # FIND USER
        # -------------------------------------------------

        cursor.execute(
            """
            SELECT id, full_name, email
            FROM users
            WHERE email = %s
            LIMIT 1
            """,
            (email,)
        )

        user = cursor.fetchone()

        # -------------------------------------------------
        # SECURITY:
        # DON'T REVEAL WHETHER EMAIL EXISTS
        # -------------------------------------------------

        if not user:

            flash(
                "If an account exists with that email, "
                "a password reset link has been sent.",
                "success"
            )

            return render_template("forgot_password.html")

        # -------------------------------------------------
        # INVALIDATE OLD UNUSED TOKENS
        # -------------------------------------------------

        cursor.execute(
            """
            UPDATE password_reset_tokens
            SET used_at = NOW()
            WHERE user_id = %s
              AND used_at IS NULL
            """,
            (user["id"],)
        )

        # -------------------------------------------------
        # GENERATE SECURE RANDOM TOKEN
        # -------------------------------------------------

        raw_token = secrets.token_urlsafe(48)

        # -------------------------------------------------
        # HASH TOKEN BEFORE DATABASE STORAGE
        # -------------------------------------------------

        token_hash = hashlib.sha256(
            raw_token.encode("utf-8")
        ).hexdigest()

        # -------------------------------------------------
        # TOKEN EXPIRATION
        # -------------------------------------------------

        expires_at = (
            datetime.now(timezone.utc).replace(tzinfo=None)
            + timedelta(minutes=30)
        )

        # -------------------------------------------------
        # STORE ONLY HASH
        # -------------------------------------------------

        cursor.execute(
            """
            INSERT INTO password_reset_tokens
            (
                user_id,
                token_hash,
                expires_at
            )
            VALUES (%s, %s, %s)
            """,
            (
                user["id"],
                token_hash,
                expires_at
            )
        )

        connection.commit()

        # -------------------------------------------------
        # CREATE RESET LINK
        # -------------------------------------------------

        reset_link = url_for(
            "reset_password",
            token=raw_token,
            _external=True
        )

        # -------------------------------------------------
        # SEND EMAIL
        # -------------------------------------------------

        send_password_reset_email(
            user["email"],
            reset_link
        )

        # -------------------------------------------------
        # GENERIC SUCCESS MESSAGE
        # -------------------------------------------------

        flash(
            "If an account exists with that email, "
            "a password reset link has been sent.",
            "success"
        )

        return render_template("forgot_password.html")

    except Exception as e:

        print("========================================")
        print("FORGOT PASSWORD ERROR")
        print(type(e).__name__)
        print(str(e))
        print("========================================")

        if connection:
            connection.rollback()

        flash(
            "We couldn't send the reset email right now. "
            "Please try again later.",
            "error"
        )

        return render_template("forgot_password.html")

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# RESET PASSWORD
# =========================================================

@app.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token):

    connection = None
    cursor = None

    try:

        # -------------------------------------------------
        # HASH THE TOKEN FROM THE URL
        #
        # The database stores token_hash, not the raw token.
        # -------------------------------------------------

        token_hash = hashlib.sha256(
            token.encode("utf-8")
        ).hexdigest()

        # -------------------------------------------------
        # DATABASE CONNECTION
        # -------------------------------------------------

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # -------------------------------------------------
        # FIND TOKEN
        # -------------------------------------------------

        cursor.execute(
            """
            SELECT
                id,
                user_id,
                token_hash,
                expires_at,
                used_at
            FROM password_reset_tokens
            WHERE token_hash = %s
            LIMIT 1
            """,
            (token_hash,)
        )

        reset_token = cursor.fetchone()

        # -------------------------------------------------
        # TOKEN DOES NOT EXIST
        # -------------------------------------------------

        if not reset_token:

            flash(
                "This password reset link is invalid.",
                "error"
            )

            return redirect(url_for("forgot_password"))

        # -------------------------------------------------
        # TOKEN ALREADY USED
        # -------------------------------------------------

        if reset_token["used_at"] is not None:

            flash(
                "This password reset link has already been used.",
                "error"
            )

            return redirect(url_for("forgot_password"))

        # -------------------------------------------------
        # TOKEN EXPIRED
        # -------------------------------------------------

        if (
            datetime.now(timezone.utc).replace(tzinfo=None)
            > reset_token["expires_at"]
        ):

            # Delete expired token
            cursor.execute(
                """
                DELETE FROM password_reset_tokens
                WHERE id = %s
                """,
                (reset_token["id"],)
            )

            connection.commit()

            flash(
                "This password reset link has expired. "
                "Please request a new one.",
                "error"
            )

            return redirect(url_for("forgot_password"))

        # =================================================
        # GET REQUEST
        # =================================================

        if request.method == "GET":

            return render_template(
                "reset_password.html",
                token=token
            )

        # =================================================
        # POST REQUEST
        # =================================================

        password = request.form.get("password", "")
        confirm_password = request.form.get(
            "confirm_password",
            ""
        )

        # -------------------------------------------------
        # REQUIRED FIELDS
        # -------------------------------------------------

        if not password or not confirm_password:

            flash(
                "Please enter and confirm your new password.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # PASSWORD MATCH
        # -------------------------------------------------

        if password != confirm_password:

            flash(
                "Passwords do not match.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # PASSWORD LENGTH
        # -------------------------------------------------

        if len(password) < 8:

            flash(
                "Password must contain at least 8 characters.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # UPPERCASE LETTER
        # -------------------------------------------------

        if not re.search(r"[A-Z]", password):

            flash(
                "Password must contain at least one uppercase letter.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # LOWERCASE LETTER
        # -------------------------------------------------

        if not re.search(r"[a-z]", password):

            flash(
                "Password must contain at least one lowercase letter.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # NUMBER
        # -------------------------------------------------

        if not re.search(r"\d", password):

            flash(
                "Password must contain at least one number.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # SPECIAL CHARACTER
        # -------------------------------------------------

        if not re.search(
            r"""[!@#$%^&*(),.?":{}|<>_\-+=/\\[\];']""",
            password
        ):

            flash(
                "Password must contain at least one special character.",
                "error"
            )

            return render_template(
                "reset_password.html",
                token=token
            )

        # -------------------------------------------------
        # CLAIM THE RESET TOKEN
        #
        # The database will only allow an unused token
        # to be claimed.
        # -------------------------------------------------

        cursor.execute(
            """
            UPDATE password_reset_tokens
            SET used_at = %s
            WHERE id = %s
              AND used_at IS NULL
            """,
            (
                datetime.now(timezone.utc).replace(tzinfo=None),
                reset_token["id"]
            )
        )

        # -------------------------------------------------
        # MAKE SURE TOKEN WAS SUCCESSFULLY CLAIMED
        # -------------------------------------------------

        if cursor.rowcount != 1:

            connection.rollback()

            flash(
                "This password reset link has already been used.",
                "error"
            )

            return redirect(url_for("forgot_password"))

        # -------------------------------------------------
        # HASH NEW PASSWORD
        # -------------------------------------------------

        password_hash = generate_password_hash(password)

        # -------------------------------------------------
        # UPDATE USER PASSWORD
        # -------------------------------------------------

        cursor.execute(
            """
            UPDATE users
            SET password_hash = %s
            WHERE id = %s
            """,
            (
                password_hash,
                reset_token["user_id"]
            )
        )

        # -------------------------------------------------
        # SAVE EVERYTHING
        # -------------------------------------------------

        connection.commit()

        # -------------------------------------------------
        # SUCCESS
        # -------------------------------------------------

        flash(
            "Your password has been reset successfully. "
            "Please sign in.",
            "success"
        )

        return redirect(url_for("login"))

    # -----------------------------------------------------
    # ERROR HANDLING
    # -----------------------------------------------------

    except Exception as e:

        print("RESET PASSWORD ERROR:", e)

        if connection:
            connection.rollback()

        flash(
            "Something went wrong while resetting your password. "
            "Please try again.",
            "error"
        )

        return redirect(url_for("forgot_password"))

    # -----------------------------------------------------
    # CLEANUP
    # -----------------------------------------------------

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# REGISTER
# =========================================================

@app.route("/register", methods=["GET", "POST"])
def register():

    # -------------------------
    # GET REQUEST
    # -------------------------

    if request.method == "GET":
        return render_template("register.html")

    # -------------------------
    # FORM DATA
    # -------------------------

    full_name = request.form.get("full_name", "").strip()
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")
    terms = request.form.get("terms")

    # -------------------------
    # REQUIRED FIELDS
    # -------------------------

    if not full_name or not email or not password or not confirm_password:
        flash("Please fill in all required fields.", "error")
        return render_template("register.html")

    # -------------------------
    # FULL NAME VALIDATION
    # -------------------------

    if len(full_name) < 2:
        flash("Please enter your full name.", "error")
        return render_template("register.html")

    # -------------------------
    # EMAIL VALIDATION
    # -------------------------

    email_pattern = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"

    if not re.match(email_pattern, email):
        flash("Please enter a valid email address.", "error")
        return render_template("register.html")

    # -------------------------
    # PASSWORD MATCH
    # -------------------------

    if password != confirm_password:
        flash("Passwords do not match.", "error")
        return render_template("register.html")

    # -------------------------
    # PASSWORD REQUIREMENTS
    # -------------------------

    if len(password) < 8:
        flash(
            "Password must contain at least 8 characters.",
            "error"
        )
        return render_template("register.html")

    if not re.search(r"[A-Z]", password):
        flash(
            "Password must contain at least one uppercase letter.",
            "error"
        )
        return render_template("register.html")

    if not re.search(r"[a-z]", password):
        flash(
            "Password must contain at least one lowercase letter.",
            "error"
        )
        return render_template("register.html")

    if not re.search(r"\d", password):
        flash(
            "Password must contain at least one number.",
            "error"
        )
        return render_template("register.html")

    if not re.search(
        r"""[!@#$%^&*(),.?":{}|<>_\-+=/\\[\];']""",
        password
    ):
        flash(
            "Password must contain at least one special character.",
            "error"
        )
        return render_template("register.html")

    # -------------------------
    # TERMS
    # -------------------------

    if not terms:
        flash(
            "Please accept the Terms of Service and Privacy Policy.",
            "error"
        )
        return render_template("register.html")

    connection = None
    cursor = None

    try:

        # -------------------------
        # DATABASE CONNECTION
        # -------------------------

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # -------------------------
        # CHECK EXISTING EMAIL
        # -------------------------

        cursor.execute(
            """
            SELECT id
            FROM users
            WHERE email = %s
            LIMIT 1
            """,
            (email,)
        )

        existing_user = cursor.fetchone()

        if existing_user:

            flash(
                "An account with this email already exists. Please sign in.",
                "error"
            )

            return render_template("register.html")

        # -------------------------
        # HASH PASSWORD
        # -------------------------

        password_hash = generate_password_hash(password)

        # -------------------------
        # CREATE USER
        # -------------------------

        cursor.execute(
            """
            INSERT INTO users
            (
                full_name,
                email,
                password_hash,
                is_active
            )
            VALUES (%s, %s, %s, %s)
            """,
            (
                full_name,
                email,
                password_hash,
                1
            )
        )

        connection.commit()

        # -------------------------
        # SUCCESS
        # -------------------------

        flash(
            "Account created successfully! Please sign in.",
            "success"
        )

        return redirect(url_for("login"))

    except Exception as e:

        print("REGISTRATION ERROR:", e)

        if connection:
            connection.rollback()

        flash(
            "Something went wrong while creating your account. Please try again.",
            "error"
        )

        return render_template("register.html")

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()
# =========================================================
# DELETE ACCOUNT
# =========================================================

# =========================================================
# LOGOUT
# =========================================================
@app.route("/logout")
def logout():

    session.clear()

    flash(
        "You have been logged out successfully.",
        "success"
    )

    return redirect(url_for("login"))
# =========================================================
# RUN APPLICATION
# =========================================================
import traceback

@app.errorhandler(500)
def internal_error(e):
    tb = traceback.format_exc()
    with open("error_log.txt", "w", encoding="utf-8") as f:
        f.write(tb)
    return "<pre>" + tb + "</pre>", 500
if __name__ == "__main__":
    app.run(debug=False)