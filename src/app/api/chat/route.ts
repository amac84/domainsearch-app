import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createRequestContext, logError, logInfo, logWarn, publicErrorMessage } from "@/lib/server-logger";
import type { NameCandidate } from "@/types";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

function summarizeNamesForContext(names: NameCandidate[]): string {
  const withCom = names.filter((c) =>
    c.domains.some((d) => d.domain === `${c.base}.com` && d.available),
  );
  const withAi = names.filter((c) =>
    c.domains.some((d) => d.domain === `${c.base}.ai` && d.available),
  );
  const availableBases = names.flatMap((c) =>
    c.domains.filter((d) => d.available).map((d) => d.domain),
  );
  const allBases = names.map((c) => c.base);
  return [
    `Total generated names: ${names.length}.`,
    `Names with .com available (${withCom.length}): ${withCom.map((c) => c.base).slice(0, 50).join(", ")}${withCom.length > 50 ? "..." : ""}.`,
    `Names with .ai available (${withAi.length}): ${withAi.map((c) => c.base).slice(0, 50).join(", ")}${withAi.length > 50 ? "..." : ""}.`,
    `All base names: ${allBases.slice(0, 120).join(", ")}${allBases.length > 120 ? "..." : ""}.`,
    `Available domains (sample): ${availableBases.slice(0, 80).join(", ")}${availableBases.length > 80 ? "..." : ""}.`,
  ].join("\n");
}

export interface ChatRequestBody {
  names: NameCandidate[];
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestContext = createRequestContext(request, "/api/chat");
  try {
    const body = (await request.json()) as ChatRequestBody;
    logInfo("api.chat.request_start", {
      ...requestContext,
      nameCount: body.names?.length ?? 0,
      hasHistory: Boolean(body.history?.length),
    });
    if (!body.names?.length) {
      logWarn("api.chat.validation_failed", {
        ...requestContext,
        reason: "missing_names",
      });
      return NextResponse.json(
        { error: "names array is required and must not be empty" },
        { status: 400 },
      );
    }
    if (!body.message?.trim()) {
      logWarn("api.chat.validation_failed", {
        ...requestContext,
        reason: "missing_message",
      });
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    const summary = summarizeNamesForContext(body.names);
    const systemContent = `You are a helpful assistant answering questions about a set of generated brand names and their domain availability. Use ONLY the following data to answer. Do not make up names or availability.

${summary}

Answer concisely. If the user asks for lists or filters, base them on the data above.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      ...(body.history ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: body.message.trim() },
    ];

    const completion = await getClient().chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.3,
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "I couldn’t generate a reply.";
    logInfo("api.chat.success", {
      ...requestContext,
      durationMs: Date.now() - startedAt,
      replyChars: reply.length,
    });
    return NextResponse.json({ reply });
  } catch (error) {
    logError("api.chat.request_failed", error, {
      ...requestContext,
      durationMs: Date.now() - startedAt,
    });
    const message = publicErrorMessage(error, "Chat request failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
