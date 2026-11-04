"""Make audit tables append-only at the database level.

Application code already treats audit rows as append-only. This migration
enforces that guarantee in PostgreSQL so a bug, an ORM cascade or a direct SQL
statement cannot silently rewrite history.

Operational maintenance (test cleanup, destructive local reseeds) can opt out of
the guard for the current database session:

    SELECT set_config('miraiwerk.audit_maintenance', 'on', false);

Production jobs should never set that flag. ``TRUNCATE`` is intentionally not
blocked because row-level triggers do not fire for it; truncation is restricted
to database owners and is used by the local demo seed only.
"""

from django.db import migrations

AUDIT_TABLES = ("security_audit", "audit_events", "decision_audit")

CREATE_FUNCTION = """
CREATE OR REPLACE FUNCTION miraiwerk_block_audit_mutation()
RETURNS trigger AS $$
BEGIN
    IF current_setting('miraiwerk.audit_maintenance', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION
        'Audit table % is append-only; % is not permitted.',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
"""

DROP_FUNCTION = "DROP FUNCTION IF EXISTS miraiwerk_block_audit_mutation();"

CREATE_TRIGGERS = "\n".join(
    f"""
DROP TRIGGER IF EXISTS {table}_immutable ON {table};
CREATE TRIGGER {table}_immutable
BEFORE UPDATE OR DELETE ON {table}
FOR EACH ROW EXECUTE FUNCTION miraiwerk_block_audit_mutation();
"""
    for table in AUDIT_TABLES
)

DROP_TRIGGERS = "\n".join(
    f"DROP TRIGGER IF EXISTS {table}_immutable ON {table};" for table in AUDIT_TABLES
)


class Migration(migrations.Migration):
    dependencies = [
        ("platform_app", "0004_security_notifications"),
    ]

    operations = [
        migrations.RunSQL(CREATE_FUNCTION + CREATE_TRIGGERS, DROP_TRIGGERS + DROP_FUNCTION),
    ]
