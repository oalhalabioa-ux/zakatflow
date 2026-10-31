// Real authenticated owner pages against the disposable stack; no API mocking.
import assert from "node:assert/strict";
const palettes = {
  yaqeen: "rgb(243, 245, 247)",
  elegant: "rgb(243, 245, 247)",
  modern: "rgb(245, 247, 255)",
  classic: "rgb(241, 245, 247)",
};
const luminance = (color) => {
  const c = color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
export async function ownerVisuals({ browser, cookies, appUrl, root }) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1.5,
  });
  await context.addCookies(
    cookies.map((c) => ({ name: c.name, value: c.value, url: appUrl })),
  );
  await context.addInitScript(() =>
    localStorage.setItem("yaqeen-owner-sidebar", "collapsed"),
  );
  const page = await context.newPage();
  for (const locale of ["ar", "en"]) {
    const ar = locale === "ar";
    await page.goto(appUrl + "/admin/subscriptions?lang=" + locale);
    for (const [theme, label] of [
      ["yaqeen", ar ? "يقين الأساسي" : "Yaqeen"],
      ["elegant", ar ? "الأنيق" : "Elegant"],
      ["modern", ar ? "العصري" : "Modern"],
      ["classic", ar ? "الكلاسيكي" : "Classic"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.ownerTheme === theme,
        theme,
      );
      assert.equal(
        await page
          .locator(".owner-shell")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        palettes[theme],
      );
      const nav = page.getByRole("navigation", {
        name: ar ? "إدارة الاشتراكات" : "Subscription management",
      });
      for (const tab of [
        ar ? "اشتراكات المؤسسات" : "Organization subscriptions",
        ar ? "طلبات التفعيل" : "Activation requests",
      ]) {
        await nav.getByRole("button", { name: tab, exact: true }).click();
        if (tab === (ar ? "اشتراكات المؤسسات" : "Organization subscriptions")) {
          await page
            .locator(".owner-institution-table tbody tr")
            .first()
            .waitFor();
          await page
            .locator(".institution-detail .owner-member")
            .first()
            .waitFor();
          assert.equal(
            await page.locator(".institution-detail select").count(),
            0,
            "Mutation forms belong in a dialog, not the detail overview",
          );
        } else {
          await page
            .locator(".owner-requests-table tbody tr")
            .first()
            .waitFor();
          await page
            .locator(".owner-request-detail .owner-decision-form")
            .waitFor();
        }
        const activeStyle = await nav
          .locator("[aria-pressed=true]")
          .evaluate((e) => ({
            bg: getComputedStyle(e).backgroundColor,
            border: getComputedStyle(e).borderBottomWidth,
          }));
        assert.equal(
          activeStyle.bg,
          "rgb(255, 255, 255)",
          "A uses the same white tab surface on every tab",
        );
        assert.equal(activeStyle.border, "3px");
        const navBox = await nav.boundingBox();
        assert.ok(
          navBox.height <= 58,
          "Desktop subnavigation must remain compact",
        );
        const widths = await nav
          .locator("button")
          .evaluateAll((items) =>
            items.map((e) => e.getBoundingClientRect().width),
          );
        assert.ok(
          Math.max(...widths) - Math.min(...widths) < 2,
          "Subnavigation fills evenly",
        );
        const split = page
            .locator(".owner-subscription-console .console-split")
            .first(),
          first = await split.locator(":scope > :first-child").boundingBox(),
          second = await split.locator(":scope > :last-child").boundingBox();
        assert.ok(
          ar ? first.x > second.x : first.x < second.x,
          "Register/detail direction follows the active language",
        );
        assert.ok(
          first.width > second.width,
          "The register has more room than the detail card",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        const contacts = await page
          .locator(".owner-contact")
          .evaluateAll((items) =>
            items.map((e) => ({
              dir: e.dir,
              whiteSpace: getComputedStyle(e).whiteSpace,
              overflow: getComputedStyle(e).textOverflow,
            })),
          );
        for (const c of contacts) {
          assert.equal(c.dir, "ltr");
          assert.equal(c.whiteSpace, "nowrap");
          assert.equal(c.overflow, "ellipsis");
        }
        const surfaces = await page
          .locator(
            ".owner-subscription-console .console-card,.owner-subscription-console .owner-console-tabs button",
          )
          .evaluateAll((items) =>
            items.map((e) => ({
              fg: getComputedStyle(e).color,
              bg: getComputedStyle(e).backgroundColor,
            })),
          );
        for (const c of surfaces) {
          const l = [luminance(c.fg), luminance(c.bg)].sort((a, b) => b - a);
          assert.ok(
            (l[0] + 0.05) / (l[1] + 0.05) >= 4.5,
            theme + " surface contrast " + JSON.stringify(c),
          );
        }
        assert.ok(
          !/[٠-٩۰-۹]/.test(
            await page.locator(".owner-subscription-console").innerText(),
          ),
        );
        const name =
          tab === (ar ? "اشتراكات المؤسسات" : "Organization subscriptions")
            ? "institutions"
            : "requests";
        await page.screenshot({
          path: new URL(
            `tests/subscriptions/screenshots/owner-${name}-${locale}-${theme}.png`,
            root,
          ).pathname,
          fullPage: true,
        });
      }
    }
  }
  // Exercise the full range requested: small phones through large desktop monitors.
  await page.goto(appUrl + "/admin/subscriptions?lang=ar");
  for (const width of [320, 360, 390, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const [id, label] of [
      ["institutions", "اشتراكات المؤسسات"],
      ["requests", "طلبات التفعيل"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page
        .locator(
          id === "institutions"
            ? ".owner-institution-table tbody tr"
            : ".owner-requests-table tbody tr",
        )
        .first()
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Outer overflow at " + width + " " + id,
      );
      if (width < 600) {
        const table = page.locator(
          id === "institutions"
            ? ".owner-institution-table"
            : ".owner-requests-table",
        );
        assert.equal(
          await table.evaluate(
            (e) => getComputedStyle(e.querySelector("tbody tr")).display,
          ),
          "grid",
        );
        assert.ok(
          await table.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          "Mobile records fit as cards",
        );
        const contacts = await table.locator("td[data-label]").count();
        assert.ok(contacts > 0, "Cards retain their field labels");
        const button = table
          .getByRole("button", {
            name: id === "institutions" ? "إدارة" : "عرض الطلب",
            exact: true,
          })
          .first();
        assert.ok(
          (await button.boundingBox()).height >= 44,
          "Mobile action touch target is at least 44px",
        );
        await button.click();
        const detail = page.locator(
          id === "institutions"
            ? "#owner-institution-details"
            : "#owner-activation-details",
        );
        await detail.waitFor();
        assert.ok((await detail.boundingBox()).width <= width - 20);
      }
      if ([320, 768, 1920].includes(width))
        await page.screenshot({
          path: new URL(
            `tests/subscriptions/screenshots/owner-${id}-ar-${width}.png`,
            root,
          ).pathname,
          fullPage: true,
        });
    }
  }
  // Expanded rail exposes the same sections; the language control keeps the current tab.
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page
    .getByRole("button", { name: "توسيع القائمة الجانبية", exact: true })
    .click();
  await page
    .locator(".owner-sub-links")
    .getByRole("link", { name: "الباقات والمميزات", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ إضافة باقة جديدة", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("tab"), "plans");
  const language = page.locator(".owner-language-control");
  assert.equal(await language.getAttribute("lang"), "en");
  assert.ok((await language.getAttribute("href")).includes("tab=plans"));
  // Plan B: create a real plan, preserve every field/capability, and inspect all theme/modal sizes.
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.goto(appUrl + "/admin/subscriptions?lang=ar&tab=plans");
  await page.getByRole("button", { name: "يقين الأساسي", exact: true }).click();
  await page
    .getByRole("button", { name: "＋ إضافة باقة جديدة", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.waitFor();
  for (const [theme, label] of [
    ["yaqeen", "يقين الأساسي"],
    ["elegant", "الأنيق"],
    ["modern", "العصري"],
    ["classic", "الكلاسيكي"],
  ]) {
    // A modal is in the top layer; set the existing preference and reload before opening again.
    if (theme !== "yaqeen") {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: label, exact: true }).click();
      await page
        .getByRole("button", { name: "＋ إضافة باقة جديدة", exact: true })
        .click();
    }
    const layout = await modal.locator(".owner-plan-grid").evaluate((e) => ({
      cols: getComputedStyle(e).gridTemplateColumns,
      overflow: e.scrollWidth > e.clientWidth + 1,
    }));
    assert.equal(layout.overflow, false, "Plan columns stay inside the modal");
    assert.equal(
      layout.cols.split(" ").length,
      2,
      "B has independent information and capability columns on desktop",
    );
    for (const box of await modal
      .locator("input[type=checkbox]")
      .evaluateAll((items) =>
        items.map((e) => e.getBoundingClientRect().toJSON()),
      ))
      assert.equal(
        box.width,
        18,
        "Checkbox width must not inherit full input width",
      );
    await page.screenshot({
      path: new URL(
        `tests/subscriptions/screenshots/owner-plan-B-ar-${theme}.png`,
        root,
      ).pathname,
      fullPage: false,
    });
  }
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await modal.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "No plan modal horizontal overflow at " + width,
    );
    assert.equal(
      await modal
        .locator(".owner-plan-grid")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
      1,
    );
    await page.screenshot({
      path: new URL(
        `tests/subscriptions/screenshots/owner-plan-B-ar-${width}.png`,
        root,
      ).pathname,
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 1366, height: 1000 });
  await modal.locator("[name=name_ar]").fill("باقة اختبار التصميم");
  await modal.locator("[name=name_en]").fill("Design acceptance plan");
  await modal.locator("[name=code]").fill("qa_design_ab");
  await modal.locator("[name=price]").fill("199");
  await modal.locator("[name=max_users]").fill("7");
  await modal
    .locator("[name=reason]")
    .fill("Verify approved plan editor saves actual catalog data");
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("/api/admin/trials/plans") &&
      r.request().method() === "POST",
  );
  await modal
    .getByRole("button", { name: "حفظ وتسجيل التغيير", exact: true })
    .click();
  assert.equal((await saved).status(), 200);
  await modal.waitFor({ state: "hidden" });
  await page.getByText("باقة اختبار التصميم", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".plan-manager .owner-feedback[data-tone=success]")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(227, 243, 233)",
  );
  await page.goto(appUrl + "/admin/subscriptions?lang=en&tab=plans");
  await page.getByRole("button", { name: "＋ Add plan", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("English name", { exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  );
  await page.screenshot({
    path: new URL("tests/subscriptions/screenshots/owner-plan-B-en.png", root)
      .pathname,
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  // Native history keeps tab/filter state without a full server navigation.
  await page.goto(appUrl + "/admin/subscriptions?lang=ar&tab=institutions");
  const orgSearch = page.locator(".institution-register input[type=search]");
  await orgSearch.fill("شركة الأفق");
  await page.waitForTimeout(350);
  await page
    .getByRole("navigation", { name: "إدارة الاشتراكات", exact: true })
    .getByRole("button", { name: "طلبات التفعيل", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "إدارة الاشتراكات", exact: true })
    .getByRole("button", { name: "اشتراكات المؤسسات", exact: true })
    .click();
  assert.equal(await orgSearch.inputValue(), "شركة الأفق");
  await page.reload();
  assert.equal(await orgSearch.inputValue(), "شركة الأفق");
  await orgSearch.fill("");
  await page
    .getByRole("navigation", { name: "إدارة الاشتراكات", exact: true })
    .getByRole("button", { name: "طلبات التفعيل", exact: true })
    .click();
  await page.locator(".owner-requests-table tbody tr").first().waitFor();
  // Review the approved record: its saved decision must be green, never the generic error style.
  const approved = page
    .locator(".owner-requests-table tbody tr")
    .filter({ hasText: "تم التفعيل" })
    .first();
  await approved.getByRole("button").click();
  const note = page.locator(".owner-decision-note");
  await note.waitFor();
  assert.equal(await note.getAttribute("data-tone"), "success");
  assert.equal(
    await note.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(227, 243, 233)",
  );
  await page.screenshot({
    path: new URL(
      "tests/subscriptions/screenshots/owner-approved-decision-green.png",
      root,
    ).pathname,
    fullPage: true,
  });
  await context.close();
}
