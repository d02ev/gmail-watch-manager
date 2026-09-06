const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN");

const TOPIC_NAME =
  "projects/project-90481009-b71a-415c-b07/topics/gmail-notifications";

const LABEL_ID = "Label_8307079987171965039";

Deno.serve(async () => {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      throw new Error("Missing Google OAuth secrets");
    }

    // 1. Exchange refresh token for a short-lived access token.
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
      console.error("Google token exchange failed:", tokenData);
      return new Response(
        JSON.stringify({
          success: false,
          step: "token_exchange",
          error: tokenData,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const accessToken = tokenData.access_token;

    // 2. Create/update the Gmail push notification watch.
    const watchResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicName: TOPIC_NAME,
          labelIds: [LABEL_ID],
          labelFilterBehavior: "include",
        }),
      },
    );

    const watchData = await watchResponse.json();

    if (!watchResponse.ok) {
      console.error("Gmail watch failed:", watchData);

      return new Response(
        JSON.stringify({
          success: false,
          step: "gmail_watch",
          error: watchData,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    console.log("Gmail watch successfully created");
    console.log("History ID:", watchData.historyId);
    console.log("Expiration:", watchData.expiration);

    return new Response(
      JSON.stringify({
        success: true,
        historyId: watchData.historyId,
        expiration: watchData.expiration,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Unexpected error:", error);

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