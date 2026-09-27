# 🌿 Serenity — Mental Wellness & Self-Care Web Application

Serenity is a web-based mental wellness and self-care application designed to help users build healthier daily routines, understand their emotional patterns, and maintain their overall well-being through a simple and supportive digital environment.

## ✨ Features

### 🔐 User Authentication

* User registration and login
* Secure password hashing
* Forgot-password functionality
* Email-based password reset
* Session-based authentication

### 😊 Mood Tracking

* Daily mood check-in
* Track emotions such as Happy, Calm, Neutral, Sad, and Stressed
* View mood-related information through the application

### 📔 Journal

* Create and manage personal journal entries
* Record thoughts and experiences
* Sentiment and emotion analysis
* Journal history and detailed journal views

### 😴 Sleep Tracker

* Record sleep and wake-up times
* Calculate sleep duration
* Track sleep quality
* Monitor sleep patterns

### ✅ Habit Tracker

* Track daily habits
* Mark habits as completed
* Support predefined and custom habits
* Maintain wellness streaks

### 🧘 Calm Corner

* Relaxation and mindfulness activities
* Breathing exercises
* A dedicated space for calming activities

### 🤖 AI Companion

* AI-powered conversational support
* Local AI integration using Ollama
* Designed to provide supportive and wellness-oriented interactions

### 📊 Insights

* Wellness-related insights based on user activity
* Mood, sleep, journal, and habit information
* Visual representation of wellness data
* AI-assisted recommendations

### 🌓 Theme Support

* Light theme
* Dark theme
* Responsive user interface

## 🛠️ Technologies Used

### Frontend

* HTML5
* CSS3
* JavaScript
* Bootstrap 5

### Backend

* Python
* Flask

### Database

* MySQL

### AI

* Ollama
* Local AI model integration

### Other Tools

* Git
* GitHub
* VS Code

## 🏗️ Application Structure

Serenity/
│
├── app.py
├── db_config.py
├── ai_analysis.py
├── insights_routes.py
├── requirements.txt
├── .gitignore
├── README.md
│
├── static/
│   ├── css/
│   └── js/
│
├── templates/
│
├── test_ai_analysis.py
├── test_db.py
└── test_ollama.py

## 🔒 Security

Serenity includes several security-related practices, including:

* Password hashing
* Session-based authentication
* Password-reset tokens
* Environment variables for sensitive configuration
* `.gitignore` protection for sensitive local files

Sensitive configuration such as database credentials and secret keys should be stored in a local `.env` file and should not be committed to GitHub.

## 🚀 Running the Project Locally

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd Serenity
```

### 2. Create a virtual environment

```bash
python -m venv .venv
```

### 3. Activate the virtual environment

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

### 5. Configure environment variables

Create a `.env` file in the project root and add the required configuration for:

* Flask secret key
* MySQL database
* Email configuration
* AI/Ollama configuration where required

Do not upload this file to GitHub.

### 6. Set up the database

Create the required MySQL database and tables used by the application.

### 7. Start the application

```bash
python app.py
```

Then open the local address displayed by Flask in your browser.

## 🎯 Project Objective

The objective of Serenity is to provide users with a single platform for managing different aspects of everyday mental wellness, including mood, journaling, sleep, habits, relaxation activities, and AI-supported interactions.

## 🔮 Future Scope

Possible future improvements include:

* More advanced wellness analytics
* Additional personalization
* Improved AI-based recommendations
* Mobile application support
* More wellness activities
* Expanded reporting and data visualization

## 👩‍💻 Developer

**Monali Chinchankar**

BCA Student

---

⭐ If you find this project interesting, feel free to explore the repository and its implementation.
