import type { Metadata } from "next";
import { PreviewView } from "@/components/preview-view";

export const metadata: Metadata = { title: "Preview" };

export default function PreviewPage() {
  return <PreviewView />;
}
