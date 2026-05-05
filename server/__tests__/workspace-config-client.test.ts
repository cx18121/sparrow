import { describe, expect, it } from "vitest";
import { createWorkspaceConfig } from "../../src/lib/workspaceConfig.js";

describe("createWorkspaceConfig", () => {
  it("defaults senderName from the user's full Google profile name", () => {
    const config = createWorkspaceConfig({
      user: {
        email: "cx267@cornell.edu",
        user_metadata: { name: "Charlie Xue" },
      },
      templates: [],
    });

    expect(config.senderName).toBe("Charlie Xue");
  });

  it("preserves the senderName explicitly saved by the user", () => {
    const config = createWorkspaceConfig({
      user: {
        email: "cx267@cornell.edu",
        user_metadata: { full_name: "Charlie Xue" },
      },
      templates: [],
      data: { senderName: "Charlie" },
    });

    expect(config.senderName).toBe("Charlie");
  });
});
