const functions = require("firebase-functions");

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const { ApolloServer, gql } = require("apollo-server-cloud-functions");
const { RESTDataSource } = require("apollo-datasource-rest");
const responseCachePlugin = require("apollo-server-plugin-response-cache");
const capitalize = require("capitalize");

const brawlerReducer = (brawlerName) => {
  const name = capitalize.words(brawlerName.replace(/\. /g, "."));
  return {
    name: name,
    imageUrl: changeToUrl({ name, type: "brawler-bs" }),
  };
};
const changeToUrl = ({ name, type }) => {
  return (
    "https://cdn.brawlify.com/" +
    type +
    "/" +
    name.replace(/\s+/g, "-") +
    ".png"
  );
};

class BrawlStarsAPI extends RESTDataSource {
  constructor() {
    super();
    this.baseURL = "https://api.brawlstars.com/v1/";
  }

  cacheOptionsFor() {
    return { ttl: 120 };
  }
  willSendRequest(request) {
    request.headers.append(
      "authorization",
      `Bearer ${functions.config().bsapi.token}`
    );
    request.headers.append("X-Forwarded-For", functions.config().bsapi.ip);
    request.headers.append("Accept", "application/json");
    request.timeout = 3000;
  }

  async getPlayers({ countryCode, brawlerId }) {
    return await this.getRanking({ countryCode, brawlerId });
  }

  async getStatistic({ playerTag }) {
    const response = await this.getBattlelog({ playerTag, filtered: true });

    const battlelogReducer = (item) => {
      const battleTimeReducer = (battleTime) =>
        battleTime.slice(0, 4) +
        "-" +
        battleTime.slice(4, 6) +
        "-" +
        battleTime.slice(6, 8) +
        "T" +
        battleTime.slice(9, 11) +
        ":" +
        battleTime.slice(11, 13) +
        ":" +
        battleTime.slice(13, 15) +
        "." +
        battleTime.slice(16, 20);

      const resultReducer = (battle) => {
        if (battle.result) {
          // console.log(battle.result);
          return battle.result;
        } else if (battle.trophyChange) {
          if (battle.trophyChange > 0) {
            return "victory";
          } else if (battle.trophyChange < 0) {
            return "defeat";
          } else {
            return "draw";
          }
        } else {
          return null;
        }
      };

      const modeReducer = (modeName) => {
        const name = capitalize.words(modeName.split(/(?=[A-Z])/).join(" "));
        return {
          name: name,
          imageUrl: changeToUrl({ name, type: "gamemode" }),
        };
      };

      const mapReducer = (mapName) => {
        const name = mapName;
        return {
          name: name,
          imageUrl: changeToUrl({ name, type: "map" }),
        };
      };

      const eventReducer = (event) => {
        if (event.id === 0 || event.map === null) {
          return null;
        } else {
          return {
            map: mapReducer(event.map),
            mode: modeReducer(event.mode),
          };
        }
      };

      const pickReducer = (battle) => {
        let picks = [];
        if (battle.teams) {
          loop: for (const team of battle.teams) {
            for (const pick of team) {
              if (pick.tag === playerTag) {
                picks = team;
                break loop;
              }
            }
          }
        } else if (battle.players) {
          for (const pick of battle.players) {
            if (pick.tag === playerTag) {
              picks.push(pick);
              break;
            }
          }
        }

        return picks.map((pick) => ({
          tag: pick.tag,
          brawler: brawlerReducer(pick.brawler.name),
        }));
      };

      // if (resultReducer(item.battle) == null) {
      //   console.log(item.battle); //TODO
      // }
      return {
        battleTime: battleTimeReducer(item.battleTime),
        event: eventReducer(item.event),
        result: resultReducer(item.battle),
        picks: pickReducer(item.battle),
      };
    };

    const formattedResponse = response.map((item) => battlelogReducer(item));

    const recordsReducer = (battlelogs) => {
      if (battlelogs.length === 0) {
        return null;
      }
      const count = {
        victory: 0,
        defeat: 0,
      };
      for (const item of battlelogs) {
        switch (item.result) {
          case "victory":
            count.victory++;
            break;
          case "defeat":
            count.defeat++;
            break;
        }
      }

      if (count.victory === 0 && count.defeat === 0) {
        return null;
      }

      const sumOfWinLossReducer = (items) => {
        let grade;

        if (count.victory === 25) {
          grade = "GOD";
        } else if (count.victory >= 20) {
          grade = "GREAT";
        } else if (count.victory >= 10) {
          grade = "GOOD";
        } else if (count.victory > 0) {
          grade = "SOSO";
        } else {
          grade = "BAD";
        }
        return {
          content: `${count.victory}勝${count.defeat}敗`,
          caption: `直近${items.length}戦`,
          grade: grade,
          staged: false,
        };
      };

      const winningPercentageReducer = (items) => {
        const rate = Math.ceil((count.victory / items.length) * 100);
        let grade;
        if (rate === 100) {
          grade = "GOD";
        } else if (rate >= 90) {
          grade = "GREAT";
        } else if (rate >= 70) {
          grade = "GOOD";
        } else if (rate >= 50) {
          grade = "SOSO";
        } else {
          grade = "BAD";
        }
        return {
          content: `${rate}%`,
          caption: "勝率",
          grade: grade,
          staged: false,
        };
      };

      const winningStreakReducer = (items) => {
        const streak = {
          victory: 0,
          defeat: 0,
        };
        for (const item of items) {
          if (item.result === "victory") {
            streak.victory++;
          } else {
            break;
          }
        }
        for (const item of items) {
          if (item.result === "defeat") {
            streak.defeat++;
          } else {
            break;
          }
        }
        let content;
        let grade;
        let caption;
        if (streak.victory === 25) {
          content = `${streak.victory}`;
          caption = "連勝中";
          grade = "GOD";
        } else if (streak.victory >= 20) {
          content = `${streak.victory}`;
          caption = "連勝中";
          grade = "GREAT";
        } else if (streak.victory >= 10) {
          content = `${streak.victory}`;
          caption = "連勝中";
          grade = "GOOD";
        } else if (streak.victory >= 0) {
          content = `${streak.victory}`;
          caption = "連勝中";
          grade = "SOSO";
        } else {
          content = `${streak.defeat}`;
          caption = "連敗中";
          grade = "BAD";
        }
        return {
          content: content,
          caption: caption,
          grade: grade,
          staged: false,
        };
      };
      return {
        sumOfWinLoss: sumOfWinLossReducer(battlelogs),
        winningPercentage: winningPercentageReducer(battlelogs),
        winningStreak: winningStreakReducer(battlelogs),
      };
    };

    let latestBattlelog;
    if (formattedResponse.length !== 0) {
      latestBattlelog = formattedResponse[0];
    } else {
      latestBattlelog = null;
    }

    return {
      records: recordsReducer(formattedResponse),
      battlelogs: formattedResponse,
      latestBattlelog: latestBattlelog,
    };
  }

  async getBrawlers() {
    const response = await this.getBrawler();
    return response.map((res) => ({ ...brawlerReducer(res.name), id: res.id }));
  }

  async getBrawler() {
    const response = await this.get("brawlers");
    if (response.items) {
      return [...response.items];
    } else {
      throw new Error(
        "returned null response from BrawlStars Official Server at getBrawler()"
      );
    }
  }

  async getRanking({ countryCode = "global", brawlerId = "" }) {
    let response;
    if (brawlerId === "") {
      response = await this.get(`rankings/${countryCode}/players`);
    } else {
      response = await this.get(
        `rankings/${countryCode}/brawlers/${brawlerId}`
      );
    }

    if (response.items) {
      return [...response.items];
    } else {
      throw new Error(
        "returned null response from BrawlStars Official Server in getRanking"
      );
    }
  }

  async getBattlelog({ playerTag, filtered = false }) {
    let response = await this.get(
      `players/${encodeURIComponent(playerTag)}/battlelog`
    );
    if (response.items) {
      if (filtered) {
        return response.items.filter(
          (item) =>
            item.battle.type === "ranked" || item.battle.type === "proLeague"
        );
      } else {
        return response.items;
      }
    } else {
      throw new Error(
        "returned null response from BrawlStars Official Server in getBattlelog"
      );
    }
  }
}

const typeDefs = gql`
  type Query {
    statistic(playerTag: ID!): Statistic!
    players(countryCode: String, brawlerId: ID): [Player!]!
    brawlers: [Brawler!]!
  }

  # -------

  type Player {
    tag: ID!
    rank: Int!
    trophies: Int!
    name: String!
    club: Club
  }

  type Club {
    name: String!
  }

  # -------

  type Statistic {
    records: Records
    battlelogs: [Battlelog!]!
    latestBattlelog: Battlelog
  }

  type Records {
    sumOfWinLoss: DisplayBoxFormat!
    winningPercentage: DisplayBoxFormat!
    winningStreak: DisplayBoxFormat!
  }

  type DisplayBoxFormat {
    content: String!
    caption: String!
    grade: String!
    staged: Boolean!
  }

  type Battlelog {
    battleTime: String!
    event: Event
    result: String
    picks: [Pick!]!
  }

  type Event {
    mode: Mode!
    map: Map!
  }

  type Mode {
    name: String!
    imageUrl: String!
  }

  type Map {
    name: String!
    imageUrl: String!
  }

  type Pick {
    tag: ID!
    brawler: Brawler!
  }

  # -------

  type Brawler {
    id: Int!
    name: String!
    imageUrl: String!
  }
`;

const resolvers = {
  Query: {
    players: async (_, { countryCode, brawlerId }, { dataSources }) =>
      await dataSources.BrawlStarsAPI.getPlayers({ countryCode, brawlerId }),
    statistic: async (_, { playerTag }, { dataSources }) =>
      await dataSources.BrawlStarsAPI.getStatistic({ playerTag }),
    brawlers: async (_, __, { dataSources }) =>
      await dataSources.BrawlStarsAPI.getBrawlers(),
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({ BrawlStarsAPI: new BrawlStarsAPI() }),
  cacheControl: {
    defaultMaxAge: 120,
  },
  // plugins: [responseCachePlugin()],
  // playground: true,
  // introspection: true,
});

exports.graphql = functions.region("asia-northeast1").https.onRequest(
  server.createHandler({
    cors: { origin: "https://bs-ranking.web.app", credentials: true },
  })
);
