// ---------------------------------------------------------------------------
// validation-rules -- declarative CEL checks the host evaluates on every write.
//
// These are the cross-field invariants that field shape cannot express and
// that do not need code. Anything requiring a registry lookup, a graph walk or
// a sibling primitive lives in validators.ts instead.
// ---------------------------------------------------------------------------

import type { ValidationRuleDef } from "@fdpm/cli";

function rule(
  id: string,
  name: string,
  targets: string[],
  predicate: string,
  expression: string,
  message: string,
  description: string,
): ValidationRuleDef {
  return {
    id,
    name,
    level: "error",
    targets,
    applies_to: targets,
    predicate,
    expression,
    message,
    description,
  };
}

const present = (field: string): string => `has(instance.field_values.${field})`;
const value = (field: string): string => `instance.field_values.${field}`;

/** Cross-field checks evaluated by the host's expression runtime. */
export function buildValidationRules(args: {
  timeRangeTypes: string[];
  pageRangeTypes: string[];
}): ValidationRuleDef[] {
  return [
    rule(
      "media:val:time-range-ordered",
      "A time range must not end before it starts",
      args.timeRangeTypes,
      "when(has(startTime) and has(endTime), endTime >= startTime)",
      `!(${present("startTime")} && ${present("endTime")}) || ${value("endTime")} >= ${value("startTime")}`,
      "endTime must not precede startTime.",
      "A covered span whose end precedes its start addresses nothing, and every consumer that clips to it produces a different wrong answer.",
    ),
    rule(
      "media:val:page-range-ordered",
      "A page range must not end before it starts",
      args.pageRangeTypes,
      "when(has(startPage) and has(endPage), endPage >= startPage)",
      `!(${present("startPage")} && ${present("endPage")}) || ${value("endPage")} >= ${value("startPage")}`,
      "endPage must not precede startPage.",
      "The pagination analogue of the time-range check.",
    ),
    rule(
      "media:val:rating-within-scale",
      "A rating must lie within the scale it declares",
      ["media:Review"],
      "when(has(rating), rating.score in [rating.worstScore, rating.bestScore])",
      `!${present("rating")} || (${value("rating")}.score >= ${value("rating")}.worstScore && ${value("rating")}.score <= ${value("rating")}.bestScore)`,
      "rating.score must lie between worstScore and bestScore.",
      "A score outside its own scale is the classic four-out-of-five versus four-out-of-ten collision, recorded rather than caught.",
    ),
    rule(
      "media:val:other-scheme-requires-name",
      'An identifier of scheme "other" must name its registry',
      ["media:Identifier"],
      'when(scheme == "other", has(schemeName))',
      `${value("scheme")} != "other" || ${present("schemeName")}`,
      'scheme "other" requires a namespaced schemeName such as "vendor:asin".',
      "The escape hatch is only usable if the registry it escapes to is named; otherwise the value is an opaque string with no resolver.",
    ),
    rule(
      "media:val:audiobook-declares-duration",
      "An audiobook edition must declare its running time",
      ["media:BookEdition"],
      'when(bookFormat == "audiobook", has(duration))',
      `${value("bookFormat")} != "audiobook" || ${present("duration")}`,
      "An audiobook edition must declare duration.",
      "Page count is absent for audiobooks, so running time is the only extent they carry; without it the edition has no measurable size at all.",
    ),
    rule(
      "media:val:repost-carries-no-body",
      "A repost carries no body of its own",
      ["media:SocialPost"],
      'when(postKind == "repost", not has(bodyText))',
      `${value("postKind")} != "repost" || !${present("bodyText")}`,
      'A repost carries no body text; use postKind "quote" instead.',
      "ActivityStreams models a repost as an activity over an object, so text attached to one belongs to a quote and mis-files as the reposter's words.",
    ),
  ];
}
