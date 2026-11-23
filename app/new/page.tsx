// OWNER: Dev 2 (New Investigation UI). /new: upload prerecorded camera files and a witness statement, run the
// real pipeline (perception -> account -> agents) and open the scene's Board and Proof.
import type { Metadata } from "next";
import { NewInvestigation } from "@/components/investigation/NewInvestigation";

export const metadata: Metadata = { title: "New Investigation · RASHOMON" };

export default function NewInvestigationPage() {
  return (
    <>
      <style>{"@keyframes rsSpin{to{transform:rotate(360deg)}}"}</style>
      <NewInvestigation />
    </>
  );
}
