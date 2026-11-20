export function subscriptionAllowsBox(status: string | null | undefined) {
  return status === "active" || status === "past_due";
}

export function subscriptionEndsBox(status: string | null | undefined) {
  return status === "canceled" || status === "unpaid" || status === "incomplete_expired";
}
