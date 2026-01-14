import { describe, it, expect } from "vitest";
import { getSmartPrefix } from "../../src/utils/bashParser.js";

describe("getSmartPrefix", () => {
  describe("Node/JS Package Managers", () => {
    it("should extract prefix for npm install", () => {
      expect(getSmartPrefix("npm install lodash")).toBe("npm install");
      expect(getSmartPrefix("npm i express")).toBe("npm i");
    });

    it("should extract prefix for pnpm add", () => {
      expect(getSmartPrefix("pnpm add -D vitest")).toBe("pnpm add");
    });

    it("should extract prefix for yarn build", () => {
      expect(getSmartPrefix("yarn build")).toBe("yarn build");
    });

    it("should handle npm run with script name", () => {
      expect(getSmartPrefix("npm run dev")).toBe("npm run dev");
      expect(getSmartPrefix("pnpm run test:unit")).toBe("pnpm run test:unit");
    });

    it("should handle pnpm -F/--filter", () => {
      expect(getSmartPrefix("pnpm -F @wave-agent/agent-sdk test")).toBe(
        "pnpm -F @wave-agent/agent-sdk test",
      );
      expect(getSmartPrefix("pnpm --filter agent-sdk build")).toBe(
        "pnpm --filter agent-sdk build",
      );
      expect(getSmartPrefix("pnpm -F pkg1 -F pkg2 test")).toBe(
        "pnpm -F pkg1 -F pkg2 test",
      );
    });

    it("should handle npm --prefix/-C", () => {
      expect(getSmartPrefix("npm --prefix packages/agent-sdk test")).toBe(
        "npm --prefix packages/agent-sdk test",
      );
      expect(getSmartPrefix("npm -C packages/agent-sdk install")).toBe(
        "npm -C packages/agent-sdk install",
      );
    });

    it("should handle yarn workspace", () => {
      expect(getSmartPrefix("yarn workspace @wave-agent/agent-sdk test")).toBe(
        "yarn workspace @wave-agent/agent-sdk test",
      );
    });

    it("should handle deno task", () => {
      expect(getSmartPrefix("deno task dev")).toBe("deno task dev");
    });
  });

  describe("Python", () => {
    it("should extract prefix for pip install", () => {
      expect(getSmartPrefix("pip install requests")).toBe("pip install");
      expect(getSmartPrefix("pip3 install numpy")).toBe("pip3 install");
    });

    it("should handle python -m pip install", () => {
      expect(getSmartPrefix("python -m pip install pandas")).toBe(
        "python -m pip install",
      );
    });

    it("should handle python -m <module>", () => {
      expect(getSmartPrefix("python -m pytest")).toBe("python -m pytest");
      expect(getSmartPrefix("python -m venv .venv")).toBe("python -m venv");
      expect(getSmartPrefix("python3 -m http.server 8000")).toBe(
        "python3 -m http.server",
      );
    });

    it("should handle conda install", () => {
      expect(getSmartPrefix("conda install numpy")).toBe("conda install");
    });
  });

  describe("Java", () => {
    it("should extract prefix for mvn clean", () => {
      expect(getSmartPrefix("mvn clean install")).toBe("mvn clean");
    });

    it("should extract prefix for gradle build", () => {
      expect(getSmartPrefix("gradle build")).toBe("gradle build");
    });

    it("should handle java -jar", () => {
      expect(getSmartPrefix("java -jar app.jar")).toBe("java -jar");
    });
  });

  describe("Rust & Go", () => {
    it("should extract prefix for cargo build", () => {
      expect(getSmartPrefix("cargo build")).toBe("cargo build");
    });

    it("should extract prefix for go get", () => {
      expect(getSmartPrefix("go get github.com/foo/bar")).toBe("go get");
    });
  });

  describe("Version Control (git)", () => {
    it("should handle git -C <path> <subcommand>", () => {
      expect(getSmartPrefix("git -C /path/to/repo status")).toBe(
        "git -C /path/to/repo status",
      );
      expect(
        getSmartPrefix("git -C ./repo commit -m 'feat: add something'"),
      ).toBe("git -C ./repo commit");
    });
  });

  describe("Containers & Infrastructure", () => {
    it("should extract prefix for docker run", () => {
      expect(getSmartPrefix("docker run -it ubuntu")).toBe("docker run");
    });

    it("should extract prefix for kubectl get", () => {
      expect(getSmartPrefix("kubectl get pods")).toBe("kubectl get");
    });

    it("should extract prefix for terraform apply", () => {
      expect(getSmartPrefix("terraform apply")).toBe("terraform apply");
    });
  });

  describe("Sudo and Env Vars", () => {
    it("should strip sudo", () => {
      expect(getSmartPrefix("sudo npm install")).toBe("npm install");
    });

    it("should strip env vars", () => {
      expect(getSmartPrefix("NODE_ENV=production npm start")).toBe("npm start");
    });
  });

  describe("Blacklist", () => {
    it("should return null for blacklisted commands", () => {
      expect(getSmartPrefix("rm -rf /")).toBeNull();
      expect(getSmartPrefix("sudo rm file")).toBeNull();
      expect(getSmartPrefix("mv old new")).toBeNull();
    });
  });

  describe("Fallback", () => {
    it("should return null for unknown commands (no smart prefix)", () => {
      expect(getSmartPrefix("ls -la")).toBeNull();
      expect(getSmartPrefix("mkdir new_dir")).toBeNull();
    });

    it("should return null for incomplete or unsafe git/python commands", () => {
      expect(getSmartPrefix("git -C /path/to/repo")).toBe(null);
      expect(getSmartPrefix("git unknown-cmd")).toBe(null);
      expect(getSmartPrefix("python -m")).toBe(null);
      expect(getSmartPrefix("python -c 'print(1)'")).toBe(null);
    });
  });
});
