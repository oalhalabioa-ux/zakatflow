import { describe, expect, it } from "vitest";
import { fundingModeCanUseExistingPurchase, generateAssetInstallments, supplierScheduleTerms, validateAssetInstallments } from "./asset-financing-plan";

const terms = { invoiceTotal: "100000", currency: "SAR", purchaseDate: "2026-11-27", downPayment: "20000", financeCost: "0" };

describe("asset financing preview", () => {
  it("reconciles the approved example at ten monthly installments of SAR 8,000", () => {
    const schedule = generateAssetInstallments(terms, 10, "MONTHLY", "2027-01-31");
    expect(schedule).toHaveLength(10);
    expect(schedule.every(item => item.principal === "8000.00" && item.financeCost === "0.00")).toBe(true);
    expect(schedule.slice(0, 3).map(item => item.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(validateAssetInstallments(terms, schedule)).toEqual({
      payableNow: "20000.00", remainingPrincipal: "80000.00", futureTotal: "80000.00", paidPercent: 20,
    });
  });

  it("preserves the final rounding remainder in both principal and financing cost", () => {
    const invoice = { ...terms, invoiceTotal: "100001.01", downPayment: "0", financeCost: "25.01" };
    const schedule = generateAssetInstallments(invoice, 3, "QUARTERLY", "2027-01-31");
    expect(schedule[2]).toEqual({ dueDate: "2027-07-31", principal: "33333.67", financeCost: "8.35" });
    expect(validateAssetInstallments(invoice, schedule).futureTotal).toBe("100026.02");
  });

  it("uses the currency minor units and accepts an unequal custom schedule", () => {
    const inputs = { ...terms, currency: "KWD", invoiceTotal: "102.005", downPayment: "2.005", financeCost: "5.001" };
    const schedule = [
      { dueDate: "2027-01-15", principal: "40.001", financeCost: "0" },
      { dueDate: "2027-03-03", principal: "59.999", financeCost: "5.001" },
    ];
    expect(validateAssetInstallments(inputs, schedule).futureTotal).toBe("105.001");
    expect(() => validateAssetInstallments({ ...inputs, currency: "SAR" }, schedule)).toThrow("ASSET_FINANCING_AMOUNT_PRECISION");
  });

  it("rejects amounts beyond the obligation, missing dates, and excess initial cash", () => {
    const schedule = generateAssetInstallments(terms, 2, "CUSTOM", "2027-01-01");
    expect(() => validateAssetInstallments(terms, schedule)).toThrow("ASSET_FINANCING_DATE_INVALID");
    schedule[1] = { dueDate: "2027-01-02", principal: "40000.01", financeCost: "0" };
    expect(() => validateAssetInstallments(terms, schedule)).toThrow("ASSET_FINANCING_SCHEDULE_TOTAL");
    expect(() => generateAssetInstallments({ ...terms, downPayment: "120000" }, 2, "ANNUAL", "2027-01-01"))
      .toThrow("ASSET_FINANCING_DOWN_PAYMENT_INVALID");
    expect(() => generateAssetInstallments(terms, 2, "ANNUAL", "2027-02-31")).toThrow("ASSET_FINANCING_DATE_INVALID");
  });

  it("keeps only the existing acquisition flows eligible for submission before the atomic contract", () => {
    expect(fundingModeCanUseExistingPurchase("PERSONAL", "CASH")).toBe(true);
    expect(fundingModeCanUseExistingPurchase("ORGANIZATION", "DEFERRED")).toBe(true);
    expect(fundingModeCanUseExistingPurchase("PERSONAL", "DEFERRED")).toBe(false);
    expect(fundingModeCanUseExistingPurchase("ORGANIZATION", "INSTALLMENTS")).toBe(false);
    expect(fundingModeCanUseExistingPurchase("PERSONAL", "MIXED")).toBe(false);
  });
});


describe("institutional payment schedule submission", () => {
  it("uses the same field precision and due dates in the preview and the Work 02 command", () => {
    const draft = generateAssetInstallments(terms, 10, "MONTHLY", "2027-01-31");
    const saved = supplierScheduleTerms("INSTALLMENTS", terms, draft);
    expect(saved.entries[0]).toEqual({kind:"DOWN_PAYMENT",due_date:"2026-11-27",principal:"20000.00"});
    expect(saved.entries[1]).toEqual({kind:"INSTALLMENT",due_date:"2027-01-31",principal:"8000.00"});
    expect(saved.entries).toHaveLength(11);
  });

  it("sends one due row for a gross VAT-inclusive deferred purchase", () => {
    const invoice = {...terms, invoiceTotal:"115000",downPayment:"0"};
    expect(supplierScheduleTerms("DEFERRED",invoice,[{dueDate:"2027-01-31",principal:"115000",financeCost:"0"}]))
      .toEqual({mode:"DEFERRED",entries:[{kind:"INSTALLMENT",due_date:"2027-01-31",principal:"115000"}]});
  });

  it("requires two installments and refuses separate financing costs on the supplier command", () => {
    const single = generateAssetInstallments(terms,1,"MONTHLY","2027-01-31");
    expect(()=>supplierScheduleTerms("INSTALLMENTS",terms,single)).toThrow("ASSET_FINANCING_COUNT_INVALID");
    const withFees = {...terms,financeCost:"100"};
    const loans = generateAssetInstallments(withFees,2,"MONTHLY","2027-01-31");
    expect(()=>supplierScheduleTerms("INSTALLMENTS",withFees,loans)).toThrow("ASSET_FINANCING_SUPPLIER_PRINCIPAL_ONLY");
  });
});
