import { emptyData } from "../lib/domain";
import { localData } from "../lib/local-flow";
import { importVerifiedAugust } from "../lib/august-data";
import { registerHistory } from "../lib/history-import";
export function augustWithSeptember() {
  let data = importVerifiedAugust(localData(emptyData()), "土屋");
  data.taxRules!.push(
    ...["2026-09", "2026-10"].map((month) => ({ ...data.taxRules![0], month })),
  );
  data.billingParties!.push({
    id: "tws-parent",
    internal_name: "TWS",
    formal_name: "TWS",
    address: "",
    active: true,
  });
  const destinations = data.customers.filter((c) => c.name.includes("TWS"));
  for (const [n, c] of destinations.entries()) {
    const site = data.sites!.find((s) => s.customer_id === c.id)!;
    data = registerHistory(
      data,
      [
        {
          row: n + 1,
          day: "2026-09-10",
          customer: c.name,
          site: site.name,
          address: "",
          quantity: String(100 * (n + 1)),
          price: "90",
          amount: "",
          operator: "土屋",
          slip: "TWS-SEP-" + n,
          notes: "9月検証",
          customerId: c.id,
          siteId: site.id,
          newCustomer: false,
          newSite: false,
          include: true,
          useSourceAmount: false,
          duplicateApproved: false,
          approved: true,
        },
      ],
      "9月検証.csv",
      "CSV",
      "土屋",
    );
  }
  return { data, destinations };
}
