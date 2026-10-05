import { describe, it, expect } from "vitest";
import { removeTrailingSemi } from "../../src/client";

describe("removeTrailingSemi", () => {
  it.each([
    ["SELECT 1;", "SELECT 1"],
    ["SELECT 1;;", "SELECT 1"],
    ["SELECT 1 ; ;", "SELECT 1"],
    ["SELECT 1", "SELECT 1"],
  ])("removes trailing semicolons: %j", (input, expected) => {
    expect(removeTrailingSemi(input)).toBe(expected);
  });

  // The semicolon has to go even when a comment follows it, or a clause
  // appended after the query (such as FORMAT) becomes a second statement.
  it.each([
    ["SELECT 1; -- note", "SELECT 1 -- note"],
    ["SELECT 1; # note", "SELECT 1 # note"],
    ["SELECT 1; /* note */", "SELECT 1 /* note */"],
    ["SELECT 1;\n-- note", "SELECT 1\n-- note"],
    ["SELECT 1; -- a\n-- b", "SELECT 1 -- a\n-- b"],
  ])("removes a semicolon followed by a comment: %j", (input, expected) => {
    expect(removeTrailingSemi(input)).toBe(expected);
  });

  it.each([
    "SELECT ';'",
    "SELECT ';' -- note",
    "SELECT 'it''s;'",
    "SELECT 'a\\';'",
    "SELECT `a;b`",
    'SELECT "a;b"',
    "SELECT 1 -- a; b",
    "SELECT 1 /* ; */",
  ])(
    "leaves semicolons inside strings, identifiers and comments: %j",
    (input) => {
      expect(removeTrailingSemi(input)).toBe(input);
    },
  );

  // Heredocs are strings too: a comment marker or semicolon inside one must not
  // hide the real trailing semicolon.
  it.each([
    ["SELECT $tag$-- text$tag$;", "SELECT $tag$-- text$tag$"],
    ["SELECT $$;$$;", "SELECT $$;$$"],
    ["SELECT $$a # b /* c$$; -- note", "SELECT $$a # b /* c$$ -- note"],
  ])("handles heredocs: %j", (input, expected) => {
    expect(removeTrailingSemi(input)).toBe(expected);
  });

  it.each([
    "SELECT $$;$$",
    "SELECT $t$ -- ; $t$",
    "SELECT 1 -- costs $5; really",
  ])("leaves semicolons inside heredocs alone: %j", (input) => {
    expect(removeTrailingSemi(input)).toBe(input);
  });

  it("strips a semicolon after a string that contains comment markers", () => {
    expect(removeTrailingSemi("SELECT '--';")).toBe("SELECT '--'");
    expect(removeTrailingSemi("SELECT '/*';")).toBe("SELECT '/*'");
  });

  it("leaves a query made only of semicolons unchanged", () => {
    expect(removeTrailingSemi(";;")).toBe(";;");
  });
});
