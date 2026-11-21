// OWNER: Dev 4. New Investigation: create a scene, add footage and a statement, run it.
import { QUESTION_SETS } from "@/lib/perception/questionSets";
import { NewInvestigation } from "@/components/investigate/NewInvestigation";

export const dynamic = "force-dynamic";

export default function NewPage() {
  return <NewInvestigation questionSets={Object.keys(QUESTION_SETS)} />;
}
