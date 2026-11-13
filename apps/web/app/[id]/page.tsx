import { Suspense } from "react";

import { Board } from "./board";

export default function Page({ params }: PageProps<"/[id]">) {
  return (
    <Suspense>
      <Board params={params} />
    </Suspense>
  );
}
