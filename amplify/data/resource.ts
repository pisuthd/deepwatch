import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/*== STEP 1 ===============================================================
The section below creates a Todo database table with a "content" field. Try
adding a new "isDone" field as a boolean. The authorization rule below
specifies that any user authenticated via an API key can "create", "read",
"update", and "delete" any "Todo" records.
=========================================================================*/
const schema = a.schema({
  Todo: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  // ─── DeepWatch Phase 1: prediction-market search ───────────────────────
  // BinaryMarket: Polymarket + Kalshi (discrete strike/outcome per row).
  // DeepBookMarket: DeepBook Predict (per oracle-strike; carries SVI math).
  // Writes happen exclusively from the scheduled fetch-markets Lambda.
  // Public read so any visitor can browse search results without auth.
  BinaryMarket: a
    .model({
      platform: a.enum(["POLYMARKET", "KALSHI"]),
      externalId: a.string().required(),        // polymarket slug or kalshi ticker
      externalEventId: a.string(),              // event_ticker / event id
      question: a.string().required(),
      description: a.string(),
      category: a.enum(["CRYPTO", "SPORTS", "POLITICS", "OTHER"]),
      subcategory: a.string(),                  // "Bitcoin", "Ethereum", …
      outcome: a.enum(["YES", "NO", "UP", "DOWN", "OTHER"]),
      impliedProb: a.float().required(),        // 0–1
      bestBidUsd: a.float(),
      bestAskUsd: a.float(),
      volume24hUsd: a.float(),
      strikeUsd: a.float(),                     // null for non-strike markets
      expiryMs: a.integer(),                    // null if no expiry
      marketType: a.enum(["UP_DOWN", "RANGE", "OTHER"]),
      url: a.string(),
      rawJson: a.string(),
      fetchedAt: a.datetime().required(),
    })
    .secondaryIndexes((idx) => [
      idx("category")
        .sortKeys(["volume24hUsd"])
        .queryField("binaryByCategory"),
      idx("expiryMs")
        .sortKeys(["fetchedAt"])
        .queryField("binaryByExpiry"),
    ])
    .authorization((allow) => [allow.publicApiKey()]),

  DeepBookMarket: a
    .model({
      oracleId: a.string().required(),
      expiryMs: a.integer().required(),
      strikeUsd: a.float().required(),          // raw 1e9, scaled at write/read
      spotUsd: a.float(),
      forwardUsd: a.float(),
      impliedProbUp: a.float(),                 // 0–1, computed from SVI+Black-76
      sviA: a.float(),
      sviB: a.float(),
      sviRho: a.float(),
      sviM: a.float(),
      sviSigma: a.float(),
      tickSizeUsd: a.float(),
      minStrikeUsd: a.float(),
      status: a.enum(["ACTIVE", "SETTLED", "PENDING"]),
      rawJson: a.string(),
      fetchedAt: a.datetime().required(),
    })
    .secondaryIndexes((idx) => [
      idx("expiryMs")
        .sortKeys(["fetchedAt"])
        .queryField("deepbookByExpiry"),
      idx("status")
        .sortKeys(["fetchedAt"])
        .queryField("deepbookByStatus"),
    ])
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
