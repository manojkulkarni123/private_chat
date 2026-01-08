'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
//TanStack Query keeps your UI and your backend data always in sync, automatically.

export const Providers = ({children}:{children:React.ReactNode}) =>{

    const [queryClient] = useState(()=>new QueryClient())

    return <QueryClientProvider client={queryClient}>
        {children}
    </QueryClientProvider>

}