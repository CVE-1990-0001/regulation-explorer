-- ============================================================
-- RegBro — SQLite Index Schema
-- ============================================================
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS act (
    id              TEXT    NOT NULL PRIMARY KEY,
    label           TEXT    NOT NULL,
    heading         TEXT,
    jurisdiction    TEXT    NOT NULL
                    CHECK(length(jurisdiction) BETWEEN 2 AND 8),
    auth_id         TEXT,
    auth_id_scheme  TEXT
                    CHECK(auth_id_scheme IN ('CELEX','CFR','USC','BGBL','OTHER') OR auth_id_scheme IS NULL),
    source_url      TEXT,
    path            TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'In Force'
                    CHECK(status IN (
                        'In Force',
                        'Partially In Force',
                        'Amended',
                        'Repealed',
                        'Pending',
                        'Draft'
                    )),
    date_in_force   TEXT,
    primary_bundle  TEXT
                    REFERENCES bundle(id) ON UPDATE CASCADE ON DELETE SET NULL,
    updated_at      TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_act_jurisdiction ON act(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_act_status       ON act(status);
CREATE INDEX IF NOT EXISTS idx_act_auth_id      ON act(auth_id);
CREATE INDEX IF NOT EXISTS idx_act_bundle       ON act(primary_bundle);

CREATE TABLE IF NOT EXISTS act_tag (
    act_id  TEXT    NOT NULL REFERENCES act(id)  ON DELETE CASCADE ON UPDATE CASCADE,
    tag     TEXT    NOT NULL
                    CHECK(length(tag) > 0 AND length(tag) <= 64),
    PRIMARY KEY (act_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_act_tag_tag ON act_tag(tag);

CREATE TABLE IF NOT EXISTS bundle (
    id          TEXT    NOT NULL PRIMARY KEY,
    label       TEXT    NOT NULL,
    description TEXT,
    parent_bundle TEXT  REFERENCES bundle(id) ON UPDATE CASCADE ON DELETE SET NULL,
    updated_at  TEXT    NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS act_bundle_member (
    bundle_id   TEXT    NOT NULL REFERENCES bundle(id) ON DELETE CASCADE ON UPDATE CASCADE,
    act_id      TEXT    NOT NULL REFERENCES act(id)    ON DELETE CASCADE ON UPDATE CASCADE,
    member_label TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bundle_id, act_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_member_act ON act_bundle_member(act_id);

CREATE TABLE IF NOT EXISTS act_ref_external (
    source_act_id   TEXT    NOT NULL REFERENCES act(id) ON DELETE CASCADE ON UPDATE CASCADE,
    target_auth_id  TEXT    NOT NULL,
    target_auth_scheme TEXT
                    CHECK(target_auth_scheme IN ('CELEX','CFR','USC','BGBL','OTHER') OR target_auth_scheme IS NULL),
    fallback_url    TEXT,
    citation_count  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (source_act_id, target_auth_id)
);

CREATE INDEX IF NOT EXISTS idx_ref_ext_target ON act_ref_external(target_auth_id);

CREATE TABLE IF NOT EXISTS act_ref_internal (
    source_act_id   TEXT    NOT NULL REFERENCES act(id) ON DELETE CASCADE ON UPDATE CASCADE,
    target_act_id   TEXT    NOT NULL REFERENCES act(id) ON DELETE CASCADE ON UPDATE CASCADE,
    target_article  TEXT,
    citation_count  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (source_act_id, target_act_id, COALESCE(target_article, ''))
);

CREATE INDEX IF NOT EXISTS idx_ref_int_target ON act_ref_internal(target_act_id);

CREATE TRIGGER IF NOT EXISTS trg_act_updated
AFTER UPDATE ON act
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE act
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bundle_updated
AFTER UPDATE ON bundle
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE bundle
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = NEW.id;
END;
