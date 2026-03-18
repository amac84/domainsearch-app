import { Suspense } from "react";
import { GateForm } from "./gate-form";
import GateLoading from "./loading";

export default function GatePage(): React.JSX.Element {
  return (
    <Suspense fallback={<GateLoading />}>
      <GateForm />
    </Suspense>
  );
}
