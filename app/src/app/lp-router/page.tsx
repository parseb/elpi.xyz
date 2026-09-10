"use client";

import { redirect } from "next/navigation";
import { useEffect } from "react";

export default function LpRouterRedirect() {
  useEffect(() => {
    redirect("/lp");
  }, []);

  return null;
}
