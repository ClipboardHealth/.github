const {
  run,
  postPrComment,
  PR_COMMENT_MARKER,
} = require("../devin-attribution-check");

// Mock global fetch
global.fetch = jest.fn();

function createMockCore() {
  return {
    info: jest.fn(),
    warning: jest.fn(),
  };
}

function createMockGithub({ email = "user@clipboardhealth.com" } = {}) {
  return {
    rest: {
      users: {
        getByUsername: jest.fn().mockResolvedValue({
          data: { email },
        }),
      },
      issues: {
        createComment: jest.fn().mockResolvedValue({}),
      },
    },
  };
}

function createMockContext({
  body = "Requested by: @someuser",
  prNumber = 42,
  htmlUrl = "https://github.com/ClipboardHealth/test/pull/42",
} = {}) {
  return {
    repo: { owner: "ClipboardHealth", repo: "test" },
    payload: {
      pull_request: {
        body,
        number: prNumber,
        html_url: htmlUrl,
      },
    },
  };
}

function mockSlackApiSuccess() {
  fetch
    .mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, user: { id: "U12345" } }),
    })
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve({ ok: true, channel: { id: "D12345" } }),
    })
    .mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SLACK_TOKEN;
});

describe("run", () => {
  describe("when PR body has no 'Requested by' line", () => {
    it("skips without taking any action", async () => {
      const core = createMockCore();
      const github = createMockGithub();
      const context = createMockContext({ body: "Just a normal PR body" });

      await run({ github, context, core });

      expect(core.info).toHaveBeenCalledWith(
        'No "Requested by: @username" found in PR body. Skipping.',
      );
      expect(github.rest.users.getByUsername).not.toHaveBeenCalled();
      expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    });
  });

  describe("when PR body has no body at all", () => {
    it("skips without taking any action", async () => {
      const core = createMockCore();
      const github = createMockGithub();
      const context = createMockContext({ body: null });
      context.payload.pull_request.body = null;

      await run({ github, context, core });

      expect(core.info).toHaveBeenCalledWith(
        'No "Requested by: @username" found in PR body. Skipping.',
      );
    });
  });

  describe("when requester is found and Slack DM succeeds", () => {
    it("posts a PR comment and sends a Slack DM", async () => {
      process.env.SLACK_TOKEN = "xoxb-fake-token";
      const core = createMockCore();
      const github = createMockGithub({ email: "someuser@clipboardhealth.com" });
      const context = createMockContext();
      mockSlackApiSuccess();

      await run({ github, context, core });

      expect(github.rest.users.getByUsername).toHaveBeenCalledWith({
        username: "someuser",
      });
      expect(github.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("@someuser"),
        }),
      );
      expect(core.info).toHaveBeenCalledWith("Slack DM sent successfully to someuser");
    });
  });

  describe("when requester has no public email", () => {
    it("posts a PR comment and skips Slack DM", async () => {
      process.env.SLACK_TOKEN = "xoxb-fake-token";
      const core = createMockCore();
      const github = createMockGithub({ email: null });
      const context = createMockContext();

      await run({ github, context, core });

      expect(core.warning).toHaveBeenCalledWith(
        "No public email on GitHub profile for someuser",
      );
      expect(github.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "ClipboardHealth",
          repo: "test",
          issue_number: 42,
          body: expect.stringContaining("@someuser"),
        }),
      );
      expect(core.warning).toHaveBeenCalledWith(
        "Skipping Slack DM: no email or SLACK_TOKEN not set",
      );
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("when SLACK_TOKEN is not set", () => {
    it("posts a PR comment and skips Slack DM", async () => {
      const core = createMockCore();
      const github = createMockGithub();
      const context = createMockContext();

      await run({ github, context, core });

      expect(github.rest.issues.createComment).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        "Skipping Slack DM: no email or SLACK_TOKEN not set",
      );
    });
  });

  describe("when GitHub API fails to fetch user", () => {
    it("posts a PR comment and skips Slack DM", async () => {
      process.env.SLACK_TOKEN = "xoxb-fake-token";
      const core = createMockCore();
      const github = createMockGithub();
      github.rest.users.getByUsername.mockRejectedValue(new Error("Not Found"));
      const context = createMockContext();

      await run({ github, context, core });

      expect(core.warning).toHaveBeenCalledWith(
        "Failed to fetch GitHub user someuser: Not Found",
      );
      expect(github.rest.issues.createComment).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("when Slack email lookup fails", () => {
    it("posts a PR comment and warns about Slack failure", async () => {
      process.env.SLACK_TOKEN = "xoxb-fake-token";
      const core = createMockCore();
      const github = createMockGithub();
      const context = createMockContext();

      fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({ ok: false, error: "users_not_found" }),
      });

      await run({ github, context, core });

      expect(github.rest.issues.createComment).toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Slack email lookup failed"),
      );
    });
  });

  describe("when Slack conversation.open fails", () => {
    it("posts a PR comment and warns about Slack failure", async () => {
      process.env.SLACK_TOKEN = "xoxb-fake-token";
      const core = createMockCore();
      const github = createMockGithub();
      const context = createMockContext();

      fetch
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({ ok: true, user: { id: "U12345" } }),
        })
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({ ok: false, error: "channel_not_found" }),
        });

      await run({ github, context, core });

      expect(github.rest.issues.createComment).toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to open Slack conversation: channel_not_found",
      );
    });
  });

  describe("when Slack chat.postMessage fails", () => {
    it("posts a PR comment and warns about Slack failure", async () => {
      process.env.SLACK_TOKEN = "xoxb-fake-token";
      const core = createMockCore();
      const github = createMockGithub();
      const context = createMockContext();

      fetch
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({ ok: true, user: { id: "U12345" } }),
        })
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({ ok: true, channel: { id: "D12345" } }),
        })
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({ ok: false, error: "not_authed" }),
        });

      await run({ github, context, core });

      expect(github.rest.issues.createComment).toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to send Slack DM: not_authed",
      );
    });
  });

  describe("username extraction", () => {
    it.each([
      { desc: "standard format", body: "Requested by: @some-user", expected: "some-user" },
      { desc: "extra whitespace", body: "Requested by:   @some-user", expected: "some-user" },
      { desc: "case insensitive", body: "requested by: @Some-User", expected: "Some-User" },
      {
        desc: "embedded in longer body",
        body: "Some PR description\n\nRequested by: @myuser\nMore text",
        expected: "myuser",
      },
      {
        desc: "trailing punctuation stripped",
        body: "Requested by: @someuser.",
        expected: "someuser",
      },
    ])("extracts username from $desc", async ({ body, expected }) => {
      const core = createMockCore();
      const github = createMockGithub({ email: null });
      const context = createMockContext({ body });

      await run({ github, context, core });

      expect(github.rest.users.getByUsername).toHaveBeenCalledWith({
        username: expected,
      });
    });
  });
});

describe("postPrComment", () => {
  it("posts a comment with the marker and mentions the user", async () => {
    const github = createMockGithub();
    const context = createMockContext();

    await postPrComment(github, context, "testuser");

    expect(github.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "ClipboardHealth",
      repo: "test",
      issue_number: 42,
      body: expect.stringContaining(PR_COMMENT_MARKER),
    });
    expect(github.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "ClipboardHealth",
      repo: "test",
      issue_number: 42,
      body: expect.stringContaining("@testuser"),
    });
  });
});
