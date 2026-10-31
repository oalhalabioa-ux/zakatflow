// Real authenticated owner pages against the disposable stack; no API mocking.
import assert from "node:assert/strict";
const palettes = {
  yaqeen: "rgb(243, 245, 247)",
  elegant: "rgb(245, 247, 246)",
  modern: "rgb(245, 247, 255)",
  classic: "rgb(242, 244, 243)",
};
const identities = {
  yaqeen: {
    main: "rgb(16, 36, 58)",
    ink: "rgb(198, 163, 93)",
    line: "rgb(198, 163, 93)",
    section: "rgb(255, 249, 239)",
    sectionInk: "rgb(16, 36, 58)",
    selected: "rgb(255, 249, 239)",
    head: "rgb(255, 254, 250)",
    sidebar: "rgb(16, 36, 58)",
  },
  elegant: {
    main: "rgb(11, 121, 101)",
    ink: "rgb(241, 210, 141)",
    line: "rgb(7, 94, 80)",
    navBg: "rgb(7, 94, 80)",
    section: "rgb(237, 240, 238)",
    sectionInk: "rgb(7, 94, 80)",
    sectionLine: "rgb(199, 159, 79)",
    selected: "rgb(241, 243, 242)",
    head: "rgb(237, 240, 238)",
    sidebar: "rgb(255, 255, 255)",
    detailBg: "rgb(237, 240, 238)",
    sectionBorderWidth: "2px",
    detailLine: "rgb(199, 159, 79)",
  },
  modern: {
    main: "rgb(52, 70, 171)",
    ink: "rgb(255, 255, 255)",
    line: "rgb(168, 182, 255)",
    section: "rgb(238, 240, 255)",
    sectionInk: "rgb(41, 60, 143)",
    sectionLine: "rgb(104, 120, 216)",
    selected: "rgb(238, 241, 255)",
    head: "rgb(250, 250, 253)",
    sidebar: "rgb(255, 255, 255)",
  },
  classic: {
    main: "rgb(23, 62, 72)",
    ink: "rgb(220, 240, 241)",
    line: "rgb(118, 174, 178)",
    section: "rgb(236, 246, 245)",
    sectionInk: "rgb(23, 62, 72)",
    sectionLine: "rgb(76, 139, 148)",
    selected: "rgb(234, 246, 244)",
    head: "rgb(254, 252, 247)",
    sidebar: "rgb(23, 62, 72)",
  },
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
        assert.equal(
          await page
            .locator(".owner-sidebar")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          identities[theme].sidebar,
          "Each theme has its own sidebar identity",
        );
        if (theme === "elegant") {
          assert.equal(
            await page.locator(".owner-sidebar .owner-light-brand:visible").count(),
            1,
            "Elegant sidebar shows one logo variant, never two stacked marks",
          );
        }
        const mainStyle = await page
          .locator(".owner-tabs a.selected")
          .evaluate((e) => ({
            ink: getComputedStyle(e).color,
            line: getComputedStyle(e).borderBottomColor,
          }));
        assert.equal(mainStyle.ink, identities[theme].ink);
        assert.equal(mainStyle.line, identities[theme].line);
        assert.ok(
          await nav
            .locator("[aria-pressed=true]")
            .evaluate((e) => parseFloat(getComputedStyle(e).borderRadius) >= 7),
          "Section selections have rounded corners",
        );
        const activeStyle = await nav
          .locator("[aria-pressed=true]")
          .evaluate((e) => ({
            bg: getComputedStyle(e).backgroundColor,
            border: getComputedStyle(e).borderBottomWidth,
            color: getComputedStyle(e).color,
            line: getComputedStyle(e).borderBottomColor,
          }));
        assert.equal(
          activeStyle.bg,
          identities[theme].section,
          "Section tabs use their own theme's light selection",
        );
        assert.equal(activeStyle.border, identities[theme].sectionBorderWidth || "3px");
        assert.equal(activeStyle.color, identities[theme].sectionInk);
        assert.equal(
          activeStyle.line,
          identities[theme].sectionLine || identities[theme].line,
        );
        const selected = page
          .locator(".owner-subscription-console tr[aria-selected=true]")
          .first();
        assert.equal(
          await selected.evaluate((e) => getComputedStyle(e).backgroundColor),
          identities[theme].selected,
        );
        assert.equal(
          await page
            .locator(".owner-subscription-console th")
            .first()
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          identities[theme].head,
          "Ivory header is distinct from the selected pale-gold record",
        );
        assert.equal(
          await page
            .locator(".owner-tabs a.selected")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          identities[theme].navBg || identities[theme].main,
        );
        for (const bg of await page
          .locator(".owner-metric-icon")
          .evaluateAll((items) =>
            items.map((e) => getComputedStyle(e).backgroundColor),
          ))
          assert.equal(
            bg,
            "rgba(0, 0, 0, 0)",
            "Metric icons have no colored tile",
          );
        if (tab === (ar ? "اشتراكات المؤسسات" : "Organization subscriptions")) {
          const detail = await page
            .locator(".owner-detail-tabs [aria-pressed=true]")
            .evaluate((e) => ({
              bg: getComputedStyle(e).backgroundColor,
              line: getComputedStyle(e).borderBottomColor,
            }));
          assert.equal(detail.bg, identities[theme].detailBg || identities[theme].main);
          assert.equal(detail.line, identities[theme].detailLine || identities[theme].line);
        }
        await selected.hover();
        assert.equal(
          await selected.evaluate((e) => getComputedStyle(e).backgroundColor),
          identities[theme].selected,
          "Hover must retain selected row styling",
        );
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
  const orgSearch = page.locator(".institution-register .owner-search input");
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
  await page.goto(appUrl + "/admin/subscriptions?lang=ar&tab=institutions");
  await page.getByRole("button", { name: "إضافة اشتراك", exact: true }).click();
  const inline = page.locator("#owner-inline-subscription");
  await inline.waitFor();
  assert.equal(await inline.locator("[name=action]").inputValue(), "activate");
  assert.equal(
    await inline.locator("input[readonly]").count(),
    1,
    "The target organization is visible and immutable in the form",
  );
  let posted = 0;
  const onPost = (request) => {
    if (
      request.url() === appUrl + "/api/admin/trials" &&
      request.method() === "POST"
    )
      posted++;
  };
  page.on("request", onPost);
  await inline
    .getByRole("button", { name: "تنفيذ وحفظ في السجل", exact: true })
    .click();
  assert.equal(
    posted,
    0,
    "Incomplete inline activation cannot submit a mutation",
  );
  page.off("request", onPost);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await inline.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
    const editorGeometry = await inline.locator("form").evaluate((e) => ({
      display: getComputedStyle(e).display,
      formWidth: e.clientWidth,
      fieldsWidth: e.querySelector("fieldset").getBoundingClientRect().width,
    }));
    assert.equal(editorGeometry.display, "block");
    assert.ok(
      editorGeometry.fieldsWidth >= editorGeometry.formWidth * 0.95,
      "Subscription fields fill the available register width",
    );
    await page.screenshot({
      path: new URL(
        `tests/subscriptions/screenshots/owner-add-subscription-ar-${width}.png`,
        root,
      ).pathname,
      fullPage: true,
    });
  }
  await inline.getByRole("button", { name: "إلغاء", exact: true }).click();
  // The shared shell and record-card rules are verified on every protected owner page.
  for (const locale of ["ar", "en"]) {
    for (const route of [
      "",
      "/users",
      "/companies",
      "/subscriptions",
      "/payments",
      "/analytics",
      "/settings",
    ]) {
      await page.setViewportSize({ width: 1366, height: 1000 });
      await page.goto(appUrl + "/admin" + route + "?lang=" + locale);
      await page.locator(".owner-top h1").waitFor();
      for (const [theme, arLabel, enLabel] of [
        ["yaqeen", "يقين الأساسي", "Yaqeen"],
        ["elegant", "الأنيق", "Elegant"],
        ["modern", "العصري", "Modern"],
        ["classic", "الكلاسيكي", "Classic"],
      ]) {
        await page
          .getByRole("button", {
            name: locale === "ar" ? arLabel : enLabel,
            exact: true,
          })
          .click();
        await page.waitForFunction(
          (theme) => document.documentElement.dataset.ownerTheme === theme,
          theme,
        );
        for (const width of [1366, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            "Admin shell overflow " +
              route +
              " " +
              locale +
              " " +
              theme +
              " " +
              width,
          );
          assert.equal(
            await page
              .locator(
                ".owner-original-brand :is(.owner-full-brand,.owner-compact-brand)",
              )
              .evaluateAll(
                (items) =>
                  items.filter(
                    (e) =>
                      e.getBoundingClientRect().width > 0 &&
                      getComputedStyle(e).display !== "none",
                  ).length,
              ),
            1,
            "One original logo is visible per theme and viewport",
          );
          const language = page.locator(".owner-language-control");
          assert.ok((await language.boundingBox()).height >= 40);
          if (width === 390) {
            for (const label of await page
              .locator(".owner-users-table td")
              .evaluateAll((items) => items.map((e) => e.dataset.label)))
              assert.ok(
                label,
                "Mobile administrative records have field labels",
              );
          }
          if (route === "/analytics") {
            assert.equal(await page.locator(".owner-metric-card").count(), 4);
            assert.ok((await page.locator(".owner-task-list a").count()) === 3);
            assert.ok(
              !/[٠-٩۰-۹]/.test(
                await page.locator(".owner-content").innerText(),
              ),
            );
            const activeCount = await page
              .locator(".owner-metric-card")
              .nth(2)
              .locator("strong")
              .innerText();
            const denominator = await page
              .locator(".owner-metric-card")
              .nth(0)
              .locator("strong")
              .innerText();
            const rate = await page
              .locator(".owner-progress")
              .getAttribute("aria-valuenow");
            assert.equal(
              Number(rate),
              Math.round(
                (Number(activeCount.replace(/[,٬]/g, "")) /
                  Number(denominator.replace(/[,٬]/g, ""))) *
                  1000,
              ) / 10,
              "Analytics share uses current organization denominator",
            );
            await page.screenshot({
              path: new URL(
                `tests/subscriptions/screenshots/owner-analytics-${locale}-${theme}-${width}.png`,
                root,
              ).pathname,
              fullPage: true,
            });
          }
          if (locale === "ar" && theme === "yaqeen" && width === 1366)
            await page.screenshot({
              path: new URL(
                `tests/subscriptions/screenshots/owner-page-${route.slice(1) || "home"}-A.png`,
                root,
              ).pathname,
              fullPage: true,
            });
        }
      }
    }
  }
  await context.close();
}
