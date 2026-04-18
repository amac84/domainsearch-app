import { NextResponse } from "next/server";

import type { GenerateRequestBody } from "@/types";
import {
  buildResponse,
  FALLBACK_STRATEGIES,
  namesWithAtLeastOneTld,
  runFullPipeline,
} from "@/lib/generate-pipeline";
import {
  createRequestContext,
  logError,
  logInfo,
  logWarn,
  publicErrorMessage,
} from "@/lib/server-logger";

function sseMessage(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestContext = createRequestContext(request, "/api/generate/stream");
  try {
    const body = (await request.json()) as GenerateRequestBody & { stream?: boolean };
    const logContext = {
      ...requestContext,
      selectedTlds: body.tlds,
      requireAllTlds: Boolean(body.requireAllTlds),
      refineFrom: Boolean(body.refineFrom),
    };
    logInfo("api.generate_stream.request_start", logContext);
    if (!body.description?.trim()) {
      logWarn("api.generate_stream.validation_failed", {
        ...requestContext,
        reason: "missing_description",
      });
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.tlds) || body.tlds.length === 0) {
      logWarn("api.generate_stream.validation_failed", {
        ...requestContext,
        reason: "missing_tlds",
      });
      return NextResponse.json({ error: "tlds are required" }, { status: 400 });
    }
    if (body.referenceDomain != null) {
      if (typeof body.referenceDomain !== "string") {
        return NextResponse.json(
          { error: "referenceDomain must be a string when provided" },
          { status: 400 },
        );
      }
      if (body.referenceDomain.length > 253) {
        return NextResponse.json(
          { error: "referenceDomain is too long" },
          { status: 400 },
        );
      }
    }

    const selectedTlds = body.tlds.map((t) => t.toLowerCase().replace(/^\.+/, ""));
    let streamClosed = false;

    const stream = new ReadableStream({
      cancel() {
        streamClosed = true;
        logWarn("api.generate_stream.client_disconnected", {
          ...requestContext,
          durationMs: Date.now() - startedAt,
        });
      },
      async start(controller) {
        const encoder = new TextEncoder();
        const closeStream = () => {
          if (streamClosed) return;
          try {
            controller.close();
          } catch {
            // no-op: stream may already be closed by consumer
          } finally {
            streamClosed = true;
          }
        };
        const enqueue = (text: string): boolean => {
          if (streamClosed) return false;
          try {
            controller.enqueue(encoder.encode(text));
            return true;
          } catch {
            streamClosed = true;
            return false;
          }
        };
        const onProgress = (message: string) => {
          if (!enqueue(sseMessage({ type: "progress", message }))) {
            throw new Error("STREAM_CLOSED");
          }
        };

        try {
          onProgress("Starting…");
          const result = await runFullPipeline(body, onProgress, logContext);

          if (result.domainLookupFailure) {
            const response = buildResponse(result, body);
            logWarn("api.generate_stream.domain_lookup_failure", {
              ...logContext,
              durationMs: Date.now() - startedAt,
              generatedCount: result.generatedNames.length,
            });
            enqueue(sseMessage({ type: "result", result: response }));
            closeStream();
            return;
          }

          if (result.names.length > 0) {
            const response = buildResponse(result, body);
            logInfo("api.generate_stream.success", {
              ...logContext,
              durationMs: Date.now() - startedAt,
              resultCount: result.names.length,
            });
            enqueue(sseMessage({ type: "result", result: response }));
            closeStream();
            return;
          }

          const relaxedFromResult = namesWithAtLeastOneTld(
            result.namesBeforeTldFilter,
            selectedTlds,
          );
          if (relaxedFromResult.length > 0) {
            const response = buildResponse(
              { ...result, names: relaxedFromResult },
              body,
              { relaxedTldFilter: true },
            );
            logWarn("api.generate_stream.relaxed_tld_filter", {
              ...logContext,
              durationMs: Date.now() - startedAt,
              resultCount: relaxedFromResult.length,
            });
            enqueue(sseMessage({ type: "result", result: response }));
            closeStream();
            return;
          }

          for (const strategy of FALLBACK_STRATEGIES) {
            const modifiedBody = strategy.modify(body);
            if (!modifiedBody) continue;

            onProgress(`No results yet. Trying fallback: ${strategy.id}…`);
            logWarn("api.generate_stream.try_fallback", {
              ...logContext,
              fallback: strategy.id,
            });
            const fallbackResult = await runFullPipeline(modifiedBody, onProgress, {
              ...logContext,
              fallback: strategy.id,
            });
            if (fallbackResult.domainLookupFailure) {
              const response = buildResponse(fallbackResult, body, {
                fallbackUsed: strategy.id,
              });
              logWarn("api.generate_stream.domain_lookup_failure", {
                ...logContext,
                fallback: strategy.id,
                durationMs: Date.now() - startedAt,
                generatedCount: fallbackResult.generatedNames.length,
              });
              enqueue(sseMessage({ type: "result", result: response }));
              closeStream();
              return;
            }
            if (fallbackResult.names.length > 0) {
              const response = buildResponse(fallbackResult, body, {
                fallbackUsed: strategy.id,
              });
              logWarn("api.generate_stream.fallback_success", {
                ...logContext,
                fallback: strategy.id,
                durationMs: Date.now() - startedAt,
                resultCount: fallbackResult.names.length,
              });
              enqueue(sseMessage({ type: "result", result: response }));
              closeStream();
              return;
            }

            const relaxed = namesWithAtLeastOneTld(
              fallbackResult.namesBeforeTldFilter,
              selectedTlds,
            );
            if (relaxed.length > 0) {
              const response = buildResponse(
                { ...fallbackResult, names: relaxed },
                body,
                { fallbackUsed: strategy.id, relaxedTldFilter: true },
              );
              logWarn("api.generate_stream.fallback_relaxed_tld", {
                ...logContext,
                fallback: strategy.id,
                durationMs: Date.now() - startedAt,
                resultCount: relaxed.length,
              });
              enqueue(sseMessage({ type: "result", result: response }));
              closeStream();
              return;
            }
          }

          const lastResortBody: GenerateRequestBody = {
            ...body,
            avoidDictionaryWords: false,
            maxSyllables: 6,
            maxLength: 20,
            temperature: 1.0,
            avoidWords: body.avoidWords?.length ? [] : body.avoidWords,
          };
          const maxLastResortAttempts = 3;
          for (let attempt = 0; attempt < maxLastResortAttempts; attempt++) {
            onProgress(
              `Still no results. Last-resort run ${attempt + 1}/${maxLastResortAttempts} with relaxed criteria…`,
            );
            logWarn("api.generate_stream.last_resort_attempt", {
              ...logContext,
              attempt: attempt + 1,
            });
            const lastResult = await runFullPipeline(
              { ...lastResortBody, temperature: 1.0 + attempt * 0.1 },
              onProgress,
              { ...logContext, fallback: "lastResort", attempt: attempt + 1 },
            );
            if (lastResult.domainLookupFailure) {
              const response = buildResponse(lastResult, body, {
                fallbackUsed: "lastResort",
              });
              logWarn("api.generate_stream.domain_lookup_failure", {
                ...logContext,
                fallback: "lastResort",
                attempt: attempt + 1,
                durationMs: Date.now() - startedAt,
                generatedCount: lastResult.generatedNames.length,
              });
              enqueue(sseMessage({ type: "result", result: response }));
              closeStream();
              return;
            }
            if (lastResult.names.length > 0) {
              const response = buildResponse(lastResult, body, {
                fallbackUsed: "lastResort",
              });
              logWarn("api.generate_stream.last_resort_success", {
                ...logContext,
                attempt: attempt + 1,
                durationMs: Date.now() - startedAt,
                resultCount: lastResult.names.length,
              });
              enqueue(sseMessage({ type: "result", result: response }));
              closeStream();
              return;
            }
            const relaxed = namesWithAtLeastOneTld(
              lastResult.namesBeforeTldFilter,
              selectedTlds,
            );
            if (relaxed.length > 0) {
              const response = buildResponse(
                { ...lastResult, names: relaxed },
                body,
                { fallbackUsed: "lastResort", relaxedTldFilter: true },
              );
              logWarn("api.generate_stream.last_resort_relaxed_tld", {
                ...logContext,
                attempt: attempt + 1,
                durationMs: Date.now() - startedAt,
                resultCount: relaxed.length,
              });
              enqueue(sseMessage({ type: "result", result: response }));
              closeStream();
              return;
            }
          }

          const response = buildResponse(result, body);
          logWarn("api.generate_stream.completed_with_zero_results", {
            ...logContext,
            durationMs: Date.now() - startedAt,
            generatedCount: result.generatedNames.length,
          });
          enqueue(sseMessage({ type: "result", result: response }));
        } catch (err) {
          if (err instanceof Error && err.message === "STREAM_CLOSED") {
            logWarn("api.generate_stream.enqueue_after_close", {
              ...requestContext,
              durationMs: Date.now() - startedAt,
            });
            return;
          }
          logError("api.generate_stream.request_failed", err, {
            ...requestContext,
            durationMs: Date.now() - startedAt,
          });
          const message = publicErrorMessage(err, "Unexpected API error");
          enqueue(sseMessage({ type: "error", error: message }));
        } finally {
          closeStream();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logError("api.generate_stream.request_failed_before_stream", error, {
      ...requestContext,
      durationMs: Date.now() - startedAt,
    });
    const message = publicErrorMessage(error, "Unexpected API error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
