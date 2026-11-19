import { domainName } from "@/lib/config";
import { json, route } from "@/lib/http";
import { isMockMode, mockProvisionMs } from "@/lib/mode";
import { loadAccount } from "@/lib/provision";
import { requireUser } from "@/lib/session";
import { toAccountView } from "@/lib/view";

export const GET = route(async () => {
  const user = await requireUser();
  const { subscription, box } = await loadAccount(user.id);
  return json(
    toAccountView({
      mock: isMockMode(),
      domain: domainName(),
      user,
      subscription,
      box,
      mockMs: mockProvisionMs(),
    }),
  );
});
