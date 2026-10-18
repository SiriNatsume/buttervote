import { SiteNavigation } from "@/components/site-navigation";
import type { SiteNavigationData } from "@/lib/page-navigation";

export async function AsyncSiteNavigation({
  navigation,
  mobile = false,
}: {
  navigation: Promise<SiteNavigationData>;
  mobile?: boolean;
}) {
  return <SiteNavigation navigation={await navigation} mobile={mobile} />;
}
