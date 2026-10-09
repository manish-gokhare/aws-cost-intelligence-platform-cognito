
import { Amplify } from "aws-amplify";

const isProduction = import.meta.env.PROD;

const redirectSignIn = isProduction
  ? "https://cost.manishcloudops.in/auth/callback"
  : "http://localhost:5173/auth/callback";

const redirectSignOut = isProduction
  ? "https://cost.manishcloudops.in/"
  : "http://localhost:5173/";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_ZS4MbbMgy",
      userPoolClientId: "6pr07jbhi2htkretkl73drp06o",

      loginWith: {
        oauth: {
          domain: "us-east-1zs4mbbmgy.auth.us-east-1.amazoncognito.com",
          scopes: ["openid", "email", "profile"],
          redirectSignIn: [redirectSignIn],
          redirectSignOut: [redirectSignOut],
          responseType: "code",
        },
      },
    },
  },
});
