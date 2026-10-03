/* 阿里云镜像是给本地(国内网络)用的。GitHub Actions 的 runner 在境外,走镜像反而多一层
   故障面:v1.0.3-alpha.1 与 v1.0.5-alpha.1 两次发布都挂在"构建并签名"这一步,报的都是
   maven.aliyun.com 回 502 —— Gradle 会把出错的仓库整个停用,后面排着的 google()/mavenCentral()
   也救不回来。镜像是为国内本机加速,CI 里只有失败面。 */
pluginManagement {
    /* 这一层解析的是插件 classpath(AGP 自己的依赖,如 com.sun.activation:all),
       不吃下面 dependencyResolutionManagement 那个开关,所以两处都得判。
       而 pluginManagement 块里拿不到 Settings 的 providers,只能读环境变量:
       流水线设 PULSE_NO_MIRROR=1,本地不带就照旧优先吃镜像。 */
    val mirrorForPlugins = System.getenv("PULSE_NO_MIRROR") == null
    repositories {
        if (mirrorForPlugins) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
            maven("https://maven.aliyun.com/repository/gradle-plugin")
        }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

/* 带 -Ppulse.noMirror(1.0.3 那版加的,留着给本地手动用)或环境变量 PULSE_NO_MIRROR
   任一都算"不吃镜像" */
val useMirror = !providers.gradleProperty("pulse.noMirror").isPresent &&
        System.getenv("PULSE_NO_MIRROR") == null

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        if (useMirror) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "pulse"
include(":app")
