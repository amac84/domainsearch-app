import { NextResponse } from "next/server";

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
import type { GenerateRequestBody } from "@/types";

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestContext = createRequestContext(request, "/api/generate");
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const logContext = {
      ...requestContext,
      selectedTlds: body.tlds,
      requireAllTlds: Boolean(body.requireAllTlds),
      refineFrom: Boolean(body.refineFrom),
    };
    logInfo("api.generate.request_start", logContext);
    if (!body.description?.trim()) {
      logWarn("api.generate.validation_failed", {
        ...requestContext,
        reason: "missing_description",
      });
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.tlds) || body.tlds.length === 0) {
      logWarn("api.generate.validation_failed", {
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

    const result = await runFullPipeline(body, undefined, logContext);

    if (result.domainLookupFailure) {
      logWarn("api.generate.domain_lookup_failure", {
        ...logContext,
        durationMs: Date.now() - startedAt,
        generatedCount: result.generatedNames.length,
      });
      return NextResponse.json(buildResponse(result, body));
    }

    if (result.names.length > 0) {
      logInfo("api.generate.success", {
        ...logContext,
        durationMs: Date.now() - startedAt,
        resultCount: result.names.length,
      });
      return NextResponse.json(buildResponse(result, body));
    }

    const relaxedFromResult = namesWithAtLeastOneTld(
      result.namesBeforeTldFilter,
      selectedTlds,
    );
    if (relaxedFromResult.length > 0) {
      logWarn("api.generate.relaxed_tld_filter", {
        ...logContext,
        durationMs: Date.now() - startedAt,
        resultCount: relaxedFromResult.length,
      });
      return NextResponse.json(
        buildResponse(
          { ...result, names: relaxedFromResult },
          body,
          { relaxedTldFilter: true },
        ),
      );
    }

    for (const strategy of FALLBACK_STRATEGIES) {
      const modifiedBody = strategy.modify(body);
      if (!modifiedBody) continue;
      logWarn("api.generate.try_fallback", {
        ...logContext,
        fallback: strategy.id,
      });

      const fallbackResult = await runFullPipeline(modifiedBody, undefined, {
        ...logContext,
        fallback: strategy.id,
      });
      if (fallbackResult.domainLookupFailure) {
        logWarn("api.generate.domain_lookup_failure", {
          ...logContext,
          fallback: strategy.id,
          durationMs: Date.now() - startedAt,
          generatedCount: fallbackResult.generatedNames.length,
        });
        return NextResponse.json(
          buildResponse(fallbackResult, body, { fallbackUsed: strategy.id }),
        );
      }
      if (fallbackResult.names.length > 0) {
        logWarn("api.generate.fallback_success", {
          ...logContext,
          fallback: strategy.id,
          durationMs: Date.now() - startedAt,
          resultCount: fallbackResult.names.length,
        });
        return NextResponse.json(
          buildResponse(fallbackResult, body, { fallbackUsed: strategy.id }),
        );
      }

      const relaxed = namesWithAtLeastOneTld(
        fallbackResult.namesBeforeTldFilter,
        selectedTlds,
      );
      if (relaxed.length > 0) {
        logWarn("api.generate.fallback_relaxed_tld", {
          ...logContext,
          fallback: strategy.id,
          durationMs: Date.now() - startedAt,
          resultCount: relaxed.length,
        });
        return NextResponse.json(
          buildResponse(
            { ...fallbackResult, names: relaxed },
            body,
            { fallbackUsed: strategy.id, relaxedTldFilter: true },
          ),
        );
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
      const attemptBody = {
        ...lastResortBody,
        temperature: 1.0 + attempt * 0.1,
      };
      logWarn("api.generate.last_resort_attempt", {
        ...logContext,
        attempt: attempt + 1,
      });
      const lastResult = await runFullPipeline(attemptBody, undefined, {
        ...logContext,
        fallback: "lastResort",
        attempt: attempt + 1,
      });
      if (lastResult.domainLookupFailure) {
        logWarn("api.generate.domain_lookup_failure", {
          ...logContext,
          fallback: "lastResort",
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          generatedCount: lastResult.generatedNames.length,
        });
        return NextResponse.json(
          buildResponse(lastResult, body, { fallbackUsed: "lastResort" }),
        );
      }
      if (lastResult.names.length > 0) {
        logWarn("api.generate.last_resort_success", {
          ...logContext,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          resultCount: lastResult.names.length,
        });
        return NextResponse.json(
          buildResponse(lastResult, body, { fallbackUsed: "lastResort" }),
        );
      }
      const relaxed = namesWithAtLeastOneTld(
        lastResult.namesBeforeTldFilter,
        selectedTlds,
      );
      if (relaxed.length > 0) {
        logWarn("api.generate.last_resort_relaxed_tld", {
          ...logContext,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          resultCount: relaxed.length,
        });
        return NextResponse.json(
          buildResponse(
            { ...lastResult, names: relaxed },
            body,
            { fallbackUsed: "lastResort", relaxedTldFilter: true },
          ),
        );
      }
    }

    logWarn("api.generate.completed_with_zero_results", {
      ...logContext,
      durationMs: Date.now() - startedAt,
      generatedCount: result.generatedNames.length,
    });
    return NextResponse.json(buildResponse(result, body));
  } catch (error) {
    logError("api.generate.request_failed", error, {
      ...requestContext,
      durationMs: Date.now() - startedAt,
    });
    const message = publicErrorMessage(error, "Unexpected API error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
