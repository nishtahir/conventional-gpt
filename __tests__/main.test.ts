import * as fs from "fs";
import "dotenv/config";
import { expect, test, describe } from "vitest";
import { vi } from "vitest";
import OpenAI from "openai";

vi.mock("@actions/github", () => {
  const rawJson = JSON.parse(
    fs.readFileSync("./__tests__/__mocks__/github-context.json", "utf8")
  );
  return {
    context: {
      ...rawJson,
      repo: {
        owner: rawJson.payload.repository.owner.login,
        repo: rawJson.payload.repository.name,
      },
    },
  };
});

vi.mock("octokit", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => {
      return {
        request: vi.fn((url: string) => {
          switch (url) {
            case "https://github.com/nishtahir/conventional-gpt/pull/1.diff":
              return {
                data: fs.readFileSync(
                  "./__tests__/__mocks__/sample-diff.txt",
                  "utf8"
                ),
              };
            default:
              throw new Error(`Request ${url} not implemented`);
          }
        }),
        rest: {
          pulls: {
            createReview: vi.fn(() => {
              return JSON.parse(
                fs.readFileSync(
                  "./__tests__/__mocks__/create-review-response.json",
                  "utf8"
                )
              );
            }),
          },
        },
      };
    }),
  };
});

vi.mock("openai");
// @ts-ignore - We're mocking the OpenAI module
OpenAI.mockImplementation(() => {
  return {
    chat: {
      completions: {
        create: vi.fn(() => {
          return JSON.parse(
            fs.readFileSync(
              "./__tests__/__mocks__/openai-response.json",
              "utf8"
            )
          );
        }),
      },
    },
  };
});

import * as core from "@actions/core";
import * as github from "@actions/github";

// We need to mock our inputs which are usually injected by Github Actions

const mockOpenAiApiKey = process.env.OPENAI_API_KEY;
const mockGithubToken = process.env.GITHUB_TOKEN;

vi.mock("@actions/core", () => {
  return {
    getInput: vi.fn().mockImplementation((name) => {
      switch (name) {
        case "model":
          return "gpt-4o";
        case "conventions-file":
          return "./CONVENTIONS.md";
        case "openai-api-key":
          return mockOpenAiApiKey;
        case "github-token":
          return mockGithubToken;
        case "exclude-paths":
          return "dist/**,**/*.json";
        default:
          throw new Error(`Input ${name} not implemented`);
      }
    }),
    setFailed: vi.fn(),
  };
});

import { run } from "../src/main";

describe("conventional-gpt", () => {
  test("should properly load github context", () => {
    // This is to make sure we're mocking the right context
    const beforeRef = github.context.payload.before;
    const afterRef = github.context.payload.after;

    expect(beforeRef).toBe("c054f321f3ebd73fdd608e5fb41ec071b3a9d3e5");
    expect(afterRef).toBe("0399b390c4412372f5f6aaa5da6d493838e4fc41");
  });

  test(
    "run should work",
    {
      timeout: 60000,
    },
    async () => {
      await run();
      expect(core.setFailed).not.toHaveBeenCalled();
    }
  );
});
