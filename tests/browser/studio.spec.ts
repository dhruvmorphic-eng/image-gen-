import { test, expect } from "@playwright/test";
const origin = "http://localhost:3107";
async function open(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Oh, the things you’ll make." }),
  ).toBeVisible();
  await expect(page.getByText(/Add an OpenAI API key/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function image() {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: "#aaa" },
  })
    .png()
    .toBuffer();
}
test("desktop: no login or model menu; references and separate canvases persist", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(
    page.getByRole("combobox", { name: "GPT Image model" }),
  ).toHaveCount(0);
  await expect(page.getByText("GPT Image 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Untitled session", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Dream up a product" }).click();
  await expect(page.getByLabel("Image prompt")).toHaveValue(/sculptural lamp/);
  await page.getByLabel("Quality").selectOption("high");
  await page.getByLabel("Image count").selectOption("3");
  await page.getByLabel("Aspect ratio").selectOption("1536x864");
  await page.screenshot({
    path: "test-results/desktop-workspace.png",
    fullPage: true,
  });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: await image(),
    });
  await expect(page.getByAltText("Reference 1", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByAltText("Reference 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Image count")).toHaveValue("3");
  await page.locator(".session-item").hover();
  await page.getByRole("button", { name: "Rename Fresh canvas" }).click();
  await page.getByLabel("Canvas name").fill("Lamp ideas");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("button", { name: "Lamp ideas", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await expect(page.getByLabel("Image prompt")).toHaveValue("");
  await expect(page.getByAltText("Reference 1", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Lamp ideas", exact: true }).click();
  await expect(page.getByAltText("Reference 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Image prompt")).toHaveValue(/sculptural lamp/);
  await page.locator(".session-item").hover();
  await page.getByRole("button", { name: "Delete Lamp ideas" }).click();
  await page
    .getByRole("button", { name: "Delete canvas", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lamp ideas", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("mobile: compact controls and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByText("YOUR CANVASES", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByLabel("Image prompt").fill("A tiny city made of paper");
  await page.getByLabel("Image count").selectOption("4");
  await expect(
    page.getByRole("button", { name: "Generate", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const bounds = await page
    .getByRole("button", { name: "Generate", exact: true })
    .boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(844);
  await page.screenshot({
    path: "test-results/mobile-workspace.png",
    fullPage: true,
  });
});
test("private endpoints require a capability; bootstrap is same-origin only", async ({
  request,
}) => {
  expect((await request.get("/api/sessions")).status()).toBe(401);
  expect(
    (
      await request.post("/api/bootstrap", {
        headers: { origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
});
test("multiple saved originals appear in grid and chat, and an individual image can be edited", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await open(page);
  const me = await (await page.request.get("/api/me")).json();
  const canvas = await (
    await page.request.post("/api/sessions", { headers: { origin } })
  ).json();
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post("/api/assets", {
      headers: {
        origin,
        "x-session-id": canvas.id,
        "Content-Type": "image/png",
      },
      data: await image(),
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const { resolve } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const db = new DatabaseSync(resolve("test-results/ui.sqlite"));
  db.prepare("UPDATE sessions SET title=? WHERE id=?").run(
    "Browser fixture",
    canvas.id,
  );
  db.prepare(
    "INSERT INTO jobs(id,user_id,session_id,prompt,model,size,quality,refs,status,result_id,results,count,created,finished) VALUES(?,?,?,?,?,?,?,?,'completed',?,?,?,?,?)",
  ).run(
    randomUUID(),
    me.user.id,
    canvas.id,
    "TEST FIXTURE — no OpenAI request",
    "gpt-image-2",
    "1024x1024",
    "medium",
    "[]",
    ids[0],
    JSON.stringify(ids),
    2,
    Date.now(),
    Date.now(),
  );
  db.close();
  await page.reload();
  await page
    .getByRole("button", { name: "Browser fixture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open large image preview" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.locator(".prompt-row")).toContainText("TEST FIXTURE");
  await expect(
    page.getByRole("button", { name: "Open large image preview" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Open large image preview" })
    .nth(1)
    .click();
  await expect(page.getByText("Original image · 32 × 32")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download Original", exact: true })
    .click();
  expect((await downloadEvent).suggestedFilename()).toContain(ids[1]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Edit image", exact: true })
    .click();
  await expect(page.getByText("Editing image 1")).toBeVisible();
  await expect(
    page.getByAltText("Reference 1", { exact: true }),
  ).toHaveAttribute("src", `/api/assets/${ids[1]}`);
  await expect(page.getByPlaceholder("What should we change?")).toHaveValue("");
  await page
    .getByRole("button", { name: "Regenerate — new paid request" })
    .first()
    .click();
  await expect(
    page.getByText(/new paid request to OpenAI for 2 images/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page
    .getByRole("button", { name: "Browser fixture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open large image preview" }),
  ).toHaveCount(2);
});
