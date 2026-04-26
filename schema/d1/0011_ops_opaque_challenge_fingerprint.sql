ALTER TABLE opaque_login_challenges ADD COLUMN credential_fingerprint TEXT;

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0011_ops_opaque_challenge_fingerprint');
