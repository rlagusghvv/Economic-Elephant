// econ_cards.js
export function buildListItems(items) {
  return items.map((it) => ({
    title: it.title.slice(0, 50),
    description: summarize(it.title),
    link: {
      web_url: it.link,
      mobile_web_url: it.link,
    },
  }));
}

function summarize(title) {
  return title.replace(/…/g, "").slice(0, 60) + " 관련 주요 뉴스입니다.";
}
