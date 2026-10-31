"use client";
import { useSearchParams } from "next/navigation";
import {
  ownerRegisterQuery,
  updateOwnerQuery,
} from "@/lib/subscriptions/owner-query";
export function useOwnerRegisterQuery(prefix: string) {
  const params = useSearchParams();
  const values = ownerRegisterQuery(
    new URLSearchParams(params.toString()),
    prefix,
  );
  return {
    ...values,
    setSearch: (search: string) =>
      updateOwnerQuery({
        [prefix + "_search"]: search,
        [prefix + "_offset"]: 0,
      }),
    setStatus: (status: string) =>
      updateOwnerQuery({
        [prefix + "_status"]: status,
        [prefix + "_offset"]: 0,
      }),
    setOffset: (next: number | ((value: number) => number)) => {
      const current = ownerRegisterQuery(
        new URLSearchParams(window.location.search),
        prefix,
      ).offset;
      updateOwnerQuery({
        [prefix + "_offset"]: typeof next === "function" ? next(current) : next,
      });
    },
  };
}
