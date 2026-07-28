const work_apps = ["Slack", "zoom.us", "iTerm2", "Workplace Chat", "Metamate"]
const personal_apps = ["WhatsApp"]
const personal_websites = ["youtube.com", "facebook.com"]
const work_websites = ["internalfb.com", "fburl.com"]

class Rule {
  constructor (props) {
    this.props = props;
  }

  match (match) {
    return { ...this.props, match };
  }
}

const personal_chrome = new Rule({
  browser: { name: "Google Chrome", profile: "Profile 1" },
});

const work_chrome = new Rule({
  browser: { name: "Google Chrome", profile: "Default" },
});

const slack = new Rule({
  browser: "/Applications/Slack.app",
});

module.exports = {
  defaultBrowser: "Google Chrome",
  options: {
    hideIcon: false,
    checkForUpdate: true,
  },
  handlers: [
    personal_chrome.match(({ url }) => personal_websites.some(website => url.host.endsWith(website))),
    work_chrome.match(({ url }) => work_websites.some(website => url.host.endsWith(website))),
    work_chrome.match(({ opener }) => work_apps.includes(opener.name)),
    personal_chrome.match(({ opener }) => personal_apps.includes(opener.name)),
    slack.match(({ url }) => url.protocol === "slack"),
  ],
};
