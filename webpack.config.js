module.exports = {
    plugins: [
        new webpack.DefinePlugin({
          'process.env.SIGNALING_SERVER_URL': JSON.stringify(process.env.SIGNALING_SERVER_URL),
        })
    ],
    }