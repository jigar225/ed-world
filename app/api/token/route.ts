import { NextResponse } from "next/server";

// Exchanges the server-side Reactor API key for a short-lived JWT.
// The API key never reaches the browser.
const REACTOR_TOKENS_URL = "https://api.reactor.inc/tokens";

// Every model the app can connect to — token works for all of them.
const ALLOWED_MODELS = [
  "reactor/happy-oyster-adventure",
  "reactor/happy-oyster-director",
  "reactor/lingbot-world-2",
];

export async function POST() {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "REACTOR_API_KEY is not set on the server" },
      { status: 500 }
    );
  }

  const t0 = Date.now();

  const r = await fetch(REACTOR_TOKENS_URL, {
    method: "POST",
    headers: {
      "Reactor-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authorization_details: [
        {
          type: "session",
          resources: { models: { match: ALLOWED_MODELS } },
        },
      ],
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    console.warn(`[token] ✗ Reactor HTTP ${r.status} in ${Date.now() - t0}ms`);
    return NextResponse.json(
      { error: `Reactor token exchange failed (${r.status}): ${text}` },
      { status: 502 }
    );
  }

  const { jwt } = await r.json();
  console.log(`[token] ✓ minted in ${Date.now() - t0}ms`);
  return NextResponse.json({ jwt });
}
