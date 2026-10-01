// API keys for usage reporting: shown once in plain text when created, stored only as a hash.
import { randomBytes } from "node:crypto";
import type { TokenKeyView } from "@aihot/contracts/token";
import { sql } from "../db.ts";
import { newShortId, sha256 } from "../lib/ids.ts";

export const KEY_PREFIX = "mh_live_";

/** 32 random characters after the prefix; the stored prefix keeps keys tellable apart in the UI. */
function newKeyValue(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export interface CreatedKey {
  id: string;
  /** The only time this value exists outside the client that asked for it. */
  token: string;
  prefix: string;
  label: string;
  createdAt: string;
}

export async function createKey(userId: string, label: string): Promise<CreatedKey> {
  const token = newKeyValue();
  const [row] = await sql<{ id: string; created_at: Date }[]>`
    INSERT INTO community_api_keys (id, user_id, key_hash, key_prefix, label)
    VALUES (${newShortId(9)}, ${userId}, ${sha256(token)}, ${token.slice(0, KEY_PREFIX.length + 6)}, ${label.slice(0, 60)})
    RETURNING id, created_at`;
  return { id: row!.id, token, prefix: token.slice(0, KEY_PREFIX.length + 6), label: label.slice(0, 60), createdAt: row!.created_at.toISOString() };
}

export async function listKeys(userId: string): Promise<TokenKeyView[]> {
  const rows = await sql<{ id: string; label: string; key_prefix: string; created_at: Date; last_used_at: Date | null }[]>`
    SELECT id, label, key_prefix, created_at, last_used_at FROM community_api_keys
    WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    prefix: r.key_prefix,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
  }));
}

export async function revokeKey(userId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE community_api_keys SET revoked_at = now() WHERE id = ${id} AND user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/** Resolves a `Bearer mh_live_…` header; returns null for anything else (never an error). */
export async function resolveKeyToken(token: string): Promise<{ userId: string; keyId: string } | null> {
  if (!token.startsWith(KEY_PREFIX) || token.length > 200) return null;
  const [row] = await sql<{ id: string; user_id: string; status: string }[]>`
    SELECT k.id, k.user_id, u.status FROM community_api_keys k JOIN community_users u ON u.id = k.user_id
    WHERE k.key_hash = ${sha256(token)} AND k.revoked_at IS NULL`;
  if (!row || row.status !== "active") return null;
  await sql`UPDATE community_api_keys SET last_used_at = now() WHERE id = ${row.id}`;
  return { userId: row.user_id, keyId: row.id };
}
