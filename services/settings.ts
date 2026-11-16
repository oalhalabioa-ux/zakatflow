import { requireUser } from "./auth";
export async function getSettings() {
  const { supabase, user } = await requireUser();
  const [{ data: profile, error: pe }, { data: settings, error: se }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
  if (pe) throw pe;
  if (se) throw se;
  // Signup provisions a profile, but does not create user_settings. Reading a
  // new account must not require a preferences row or perform a hidden write.
  return {
    profile,
    settings: settings ?? {
      user_id: user.id,
      allocation_method: "FIFO",
      notifications_enabled: true,
      assessment_reminders: true,
      theme: "system",
    },
  };
}
export async function updateSettings(input: any) {
  const { supabase, user } = await requireUser();
  const { profile, settings } = input;
  if (profile) {
    const { error } = await supabase
      .from("profiles")
      .update({
        name: profile.name,
        phone: profile.phone,
        base_currency: profile.base_currency,
        calendar_type: profile.calendar_type,
        nisab_standard: profile.nisab_standard,
        locale: profile.locale,
        timezone: profile.timezone,
        zakat_method_id: profile.zakat_method_id,
      })
      .eq("id", user.id);
    if (error) throw error;
  }
  if (settings) {
    const { error } = await supabase
      .from("user_settings")
      .upsert({ ...settings, user_id: user.id });
    if (error) throw error;
  }
  return getSettings();
}
