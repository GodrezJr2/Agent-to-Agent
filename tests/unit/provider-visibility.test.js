import { describe, it, expect } from "vitest";
import {
  APIKEY_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
} from "../../src/shared/constants/providers.js";

describe("provider dashboard visibility", () => {
  it("lists DeepSeek Web with API key providers rendered on providers page", () => {
    expect(APIKEY_PROVIDERS["deepseek-web"]).toMatchObject({
      id: "deepseek-web",
      authType: "apikey",
      name: "DeepSeek Web",
    });
    expect(WEB_COOKIE_PROVIDERS["deepseek-web"]).toBeUndefined();
  });
});
