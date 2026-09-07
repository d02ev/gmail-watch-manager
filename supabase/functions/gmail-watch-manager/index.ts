import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const TOPIC_NAME =
  "projects/project-90481009-b71a-415c-b07/topics/gmail-notifications";

const LABEL_IDS = ["Label_8307079987171965039", "Label_7525751205411083036"];

// Renew if the watch expires within 30 minutes.
const RENEWAL_THRESHOLD_MS = 30 * 60 * 1000;

Deno.serve(async () => {
  try {
    if (
      !CLIENT_ID ||
      !CLIENT_SECRET ||
      !REFRESH_TOKEN ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    );

    // Check existing watch state.
    const { data: state, error: stateError } = await supabase
      .from("gmail_watch_states")
      .select("history_id, expiration")
      .eq("id", 1)
      .maybeSingle();

    if (stateError) {
      throw new Error(`Database read failed: ${stateError.message}`);
    }

    if (state) {
      const expirationMs = new Date(state.expiration).getTime();
      const now = Date.now();

      if (expirationMs - now > RENEWAL_THRESHOLD_MS) {
        console.log("Existing Gmail watch is still valid.");

        return new Response(
          JSON.stringify({
            success: true,
            renewed: false,
            expiration: state.expiration,
            historyId: state.history_id,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    console.log("Creating/renewing Gmail watch.");

    // Exchange refresh token for access token.
    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: REFRESH_TOKEN,
          grant_type: "refresh_token",
        }),
      },
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(
        `Google token exchange failed: ${JSON.stringify(tokenData)}`,
      );
    }

    // Create Gmail watch.
    const watchResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicName: TOPIC_NAME,
          labelIds: LABEL_IDS,
          labelFilterBehavior: "include",
        }),
      },
    );

    const watchData = await watchResponse.json();

    if (!watchResponse.ok) {
      throw new Error(
        `Gmail watch failed: ${JSON.stringify(watchData)}`,
      );
    }

    const expiration = new Date(
      Number(watchData.expiration),
    ).toISOString();

    // Save the new watch state.
    const { error: upsertError } = await supabase
      .from("gmail_watch_states")
      .upsert({
        id: 1,
        history_id: String(watchData.historyId),
        expiration,
        updated_at: new Date().toISOString(),
      });

    if (upsertError) {
      throw new Error(
        `Database write failed: ${upsertError.message}`,
      );
    }

    console.log("Gmail watch renewed.");
    console.log("History ID:", watchData.historyId);
    console.log("Expiration:", expiration);

    return new Response(
      JSON.stringify({
        success: true,
        renewed: true,
        historyId: watchData.historyId,
        expiration,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Watch manager error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});