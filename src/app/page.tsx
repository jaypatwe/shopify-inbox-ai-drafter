import { getProducts, getQuestions } from "@/lib/catalog";
import { InboxApp } from "@/components/InboxApp";

export default function Home() {
  return <InboxApp products={getProducts()} questions={getQuestions()} />;
}
