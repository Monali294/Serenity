from db_config import get_db_connection

try:
    conn = get_db_connection()
    print("✅ Database connection successful!")
    cursor = conn.cursor()
    cursor.execute("SELECT 1")
    print("✅ Test query worked:", cursor.fetchone())
    cursor.close()
    conn.close()
except Exception as e:
    print("❌ Database connection FAILED:")
    print(e)