/** @type {import('next').NextConfig} */
const config = {
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    '/api/**/*': ['fonts/**/*'],
  },
  experimental: {
    outputFileTracingIncludes: {
      "/api/howlo/card": ["./fonts/**", "./public/**"],
      "/api/howlo/card-image": ["./fonts/**", "./public/**"],
      "/api/slack/commands": ["./fonts/**", "./public/**"]
    }
  },
  output: 'standalone'
}

export default config;