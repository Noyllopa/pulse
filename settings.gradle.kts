pluginManagement {
    repositories {
        // 国内网络环境下优先走镜像,失败后回落到官方仓库
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/central")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

/* 阿里云镜像是给本地(国内网络)用的。GitHub Actions 的 runner 在境外,走镜像反而多一层
   故障面:1.0.3-alpha.1 那次发布就是 maven.aliyun.com 回 502 挂在"构建并签名"这一步
   (Gradle 会把出错的仓库整个停用,后面排着的 google()/mavenCentral() 也救不回来)。
   流水线带 -Ppulse.noMirror 就只用官方仓库;本地不带这个参数,照旧优先吃镜像。 */
val useMirror = !providers.gradleProperty("pulse.noMirror").isPresent

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
