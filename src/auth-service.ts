import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { shell } from "electron";
import crypto from "crypto";

// ── Lazy Supabase client ────────────────────────────────────
let _supabase: SupabaseClient | null = null;

function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY; // ← anon, not service key
    if (!url || !key) throw new Error("Missing Supabase env vars");
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// ── Pending auth tokens ─────────────────────────────────────
const pendingTokens = new Map<string, any>();

// ── Bot-based login (no widget) ─────────────────────────────
export async function startTelegramAuth(): Promise<string> {
  const token = crypto.randomBytes(16).toString("hex");

  await getSupabase().from("auth_tokens").insert({
    token,
    confirmed:  false,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });

  shell.openExternal(
    `https://t.me/${process.env.BOT_USERNAME}?start=login_${token}`
  );
  return token;
}

export async function checkAuthToken(
  token: string
): Promise<{ success: boolean; telegramId?: number }> {
  const { data } = await getSupabase()
    .from("auth_tokens")
    .select("confirmed, telegram_id, expires_at")
    .eq("token", token)
    .single();

  if (!data) return { success: false };

  // Token expired
  if (new Date(data.expires_at) < new Date()) {
    await getSupabase().from("auth_tokens").delete().eq("token", token);
    return { success: false };
  }

  if (data.confirmed && data.telegram_id) {
    // Clean up
    await getSupabase().from("auth_tokens").delete().eq("token", token);
    return { success: true, telegramId: data.telegram_id };
  }

  return { success: false };
}

export async function confirmAuthToken(
  token: string,
  tgUser: any
): Promise<boolean> {
  // Check token exists and is not expired
  const { data } = await getSupabase()
    .from("auth_tokens")
    .select("token, expires_at")
    .eq("token", token)
    .single();

  if (!data || new Date(data.expires_at) < new Date()) return false;

  // Upsert user
  const now = new Date();
  const { data: existing } = await getSupabase()
    .from("users")
    .select("id")
    .eq("telegram_id", tgUser.id)
    .single();

  if (!existing) {
    await getSupabase().from("users").insert({
      telegram_id:         tgUser.id,
      first_name:          tgUser.first_name,
      username:            tgUser.username  || null,
      photo_url:           tgUser.photo_url || null,
      subscription_status: "trial",
      trial_start:         now.toISOString(),
      trial_end:           new Date(now.getTime() + 1 * 86400_000).toISOString(),
    });
  }

  // Mark token as confirmed
  await getSupabase()
    .from("auth_tokens")
    .update({ confirmed: true, telegram_id: tgUser.id })
    .eq("token", token);

  return true;
}

// ── Subscription status ─────────────────────────────────────
export async function getSubscriptionStatus(telegramId: number) {
  const { data, error } = await getSupabase()
    .from("subscription_status_live")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (error || !data) throw new Error("User not found");

  if (data.live_status !== data.subscription_status) {
    await getSupabase()
      .from("users")
      .update({ subscription_status: data.live_status })
      .eq("telegram_id", telegramId);
  }

  return {
    user: {
      first_name: data.first_name,
      photo_url:  data.photo_url,
    },
    status:    data.live_status,
    daysLeft:  data.days_left,
    trialStart: data.trial_start,
    periodEnd:  data.period_end,
    price:     "₩9,900",
  };
}

// ── Open payment bot ────────────────────────────────────────
export function openPaymentBot(): void {
  shell.openExternal(`https://t.me/${process.env.BOT_USERNAME}?start=pay`);
}

// ── Extend subscription (used by bot.ts) ────────────────────
export async function extendSubscription(telegramId: number, days: number): Promise<void> {
  const { data: user } = await getSupabase()
    .from("users")
    .select("subscription_end")
    .eq("telegram_id", telegramId)
    .single();

  const base = user?.subscription_end
    ? new Date(Math.max(Date.now(), new Date(user.subscription_end).getTime()))
    : new Date();

  const newEnd = new Date(base.getTime() + days * 86400_000);

  await getSupabase()
    .from("users")
    .update({
      subscription_status: "active",
      subscription_end:    newEnd.toISOString(),
      updated_at:          new Date().toISOString(),
    })
    .eq("telegram_id", telegramId);
}