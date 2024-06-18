import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "fs";
import { Octokit } from "octokit";
import parseDiff from "parse-diff";
import { minimatch } from "minimatch";

import OpenAI from "openai";

const PERMANENT_EXCLUDE_PATHS = ["/dev/null"];
const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  "./templates/system-prompt.txt",
  "utf8"
);

/**
 * Inputs for the ConventionalGpt action
 */
interface ConventionalGptInputs {
  model: string;
  openaiApiKey: string;
  githubToken: string;
  excludePaths: string[];
  conventionsFile?: string;
}

/**
 * Review comment
 */
interface ReviewComment {
  body: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
}

interface PullRequestDetails {
  owner: string;
  repo: string;
  pull_number: number;
  // commit_id?: string;
}

/**
 * Get the diff of the pull request
 * @param octokit octokit instance
 * @param context github context
 * @param excludePaths paths to exclude from the diff
 * @returns parsed diff of the pull request
 */
async function diffWithContext(
  octokit: Octokit,
  diffUrl: string,
  excludePaths: string[]
): Promise<parseDiff.File[]> {
  const { data } = await octokit.request(diffUrl);
  const totalExcludePaths = [...PERMANENT_EXCLUDE_PATHS, ...excludePaths];
  const diff = parseDiff(data).filter((file) => {
    if (!file.to) {
      return false;
    }
    const to = file.to as string;
    return !totalExcludePaths.some((pattern) => minimatch(to, pattern));
  });

  return diff;
}

/**
 * Entry point for the ConventionalGpt action. Excelsior!
 */
export async function run(): Promise<void> {
  const inputs: ConventionalGptInputs = {
    model: core.getInput("model") || "gpt-4o",
    openaiApiKey: core.getInput("openai-api-key"),
    githubToken: core.getInput("github-token"),
    excludePaths: core.getInput("exclude-paths").split(","),
    conventionsFile: core.getInput("conventions-file") || undefined,
  };

  const openai = new OpenAI({
    apiKey: inputs.openaiApiKey,
  });

  const diffUrl = github.context.payload.pull_request?.diff_url;
  if (!diffUrl) {
    throw new Error("No diff URL found in context");
  }

  const octokit = new Octokit({ auth: inputs.githubToken });

  const pullRequestDetails: PullRequestDetails = {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: github.context.payload.pull_request!.number,
  };

  const diff = await diffWithContext(octokit, diffUrl, inputs.excludePaths);
  const reviewsComments = await reviewDiff(
    diff,
    openai,
    inputs.model,
    inputs.conventionsFile
  );

  await createReview(octokit, pullRequestDetails, reviewsComments);
}

/**
 *
 * @param diff
 * @param openai
 * @param model
 * @param conventionsFile
 * @returns
 */
async function reviewDiff(
  diff: parseDiff.File[],
  openai: OpenAI,
  model: string,
  conventionsFile?: string
): Promise<ReviewComment[]> {
  const reviewComments = [];

  for (const file of diff) {
    const diffText = file.chunks
      .map((chunk) =>
        chunk.changes
          .map((change) => {
            let lineNumber = null;
            switch (change.type) {
              case "normal":
                lineNumber = change.ln2;
                break;
              default:
                lineNumber = change.ln;
                break;
            }

            return `${lineNumber} ${change.content}`;
          })
          .join("\n")
      )
      .join("\n");

    let conventions = "";
    if (conventionsFile) {
      conventions = fs.readFileSync(conventionsFile, "utf8");
    }

    const prompt = SYSTEM_PROMPT_TEMPLATE.replace("{{diff}}", diffText).replace(
      "{{conventions}}",
      conventions
    );
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "post_review_comment",
            description: "Add a comment to the pull request with the review",
            parameters: {
              type: "object",
              properties: {
                line: {
                  type: "integer",
                  description: "The line number to comment on",
                },
                comment: {
                  type: "string",
                  description: "The comment to add to the pull request",
                },
                side: {
                  type: "string",
                  description:
                    "The side of the diff to comment on. Deletions or lines with a '-' are on the LEFT, additions  or lines with a '+' are on the RIGHT",
                  enum: ["LEFT", "RIGHT"],
                },
              },
              required: ["line", "comment", "side"],
            },
          },
        },
      ],
      tool_choice: "auto",
    });

    const message = response.choices[0].message;
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const toolCallFunction = toolCall.function;
        // TODO handle non-function tool calls
        const { line, comment, side } = openAiUnsafeArgumentsParser(
          toolCallFunction.arguments
        );
        reviewComments.push({
          body: comment,
          line: line,
          path: file.to as string,
          side: side,
        } as ReviewComment);
      }
    }

    // TODO remove this
    break;
  }

  return reviewComments;
}

async function createReview(
  octokit: Octokit,
  details: PullRequestDetails,
  comments: ReviewComment[]
) {
  await octokit.rest.pulls.createReview({
    event: "COMMENT",
    comments: comments,
    ...details,
  });

  console.log(`Created a review with ${comments.length} comments`);
}

/**
 *
 * @param args
 * @returns
 */
function openAiUnsafeArgumentsParser(args: string): {
  line: number | undefined;
  comment: string | undefined;
  side: string | undefined;
} {
  const rawLineNumber = /"line"\s*:\s*(-?\d+)/.exec(args);
  const rawComment = /"comment"\s*:\s*"(.*)",/.exec(args);
  const rawSide = /"side"\s*:\s*"(.*)"/.exec(args);

  return {
    line: rawLineNumber ? parseInt(rawLineNumber[1]) : undefined,
    comment: rawComment ? rawComment[1].replace(/\\"/g, '"') : undefined,
    side: rawSide ? rawSide[1] : undefined,
  };
}
