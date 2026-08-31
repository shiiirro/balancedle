import { createClient, FunctionsHttpError } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getPlayer(): Promise<string | null> {
    const {
        data: { session },
        error,
    } = await supabase.auth.getSession();

    if (error) {
        console.error("Session error:", error);
        return null;
    }

    if (session) {
        // console.log("Already signed in:", session.user.id);
        return session.user.id;
    }

    const { data, error: signInError } = await supabase.auth.signInAnonymously();

    if (signInError) {
        // console.error("Anonymous sign-in failed:", signInError);
        return null;
    }

    // console.log("Anonymous user:", data.user?.id);
    return data.user?.id || null;
}
