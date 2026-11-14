import { Suspense } from "react";

import { Demo } from "./demo";

export default function Page({ searchParams }: PageProps<"/demo">) {
  return (
    <Suspense>
      <Demo searchParams={searchParams} />
    </Suspense>
  );
}
