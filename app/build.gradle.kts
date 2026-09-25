import com.android.build.api.artifact.SingleArtifact
import java.util.Locale
import java.util.Properties

plugins {
    id("com.android.application")
}

/* 版本号:主版本.次版本.修订号[-预发布标识]。
   正式版不带任何后缀;预发布只允许 alpha / beta / rc 加序号。改版本只改这一行。 */
val pulseVersion = "1.0.1-alpha.1"

/* Android 只认 versionCode 这一个整数,所以把三段号与预发布阶段编进位段:
   主*1e6 + 次*1e4 + 修订*100 + 预发布槽(alpha/beta/rc 各占 32 格)。
   正式版占同一修订号的最高槽 99,于是 1.0.1-alpha.1(1000101) 可直接升级到 1.0.1(1000199)。 */
fun versionCodeOf(v: String): Int {
    val m = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$""").matchEntire(v)
        ?: error("版本号格式应为 主.次.修订[-alpha|beta|rc.N],当前为 $v")
    val major = m.groupValues[1].toInt()
    val minor = m.groupValues[2].toInt()
    val patch = m.groupValues[3].toInt()
    val stage = m.groupValues[4]
    val n = m.groupValues[5]
    require(minor < 100 && patch < 100) { "次版本与修订号需小于 100:$v" }
    val slot = when {
        stage.isEmpty() -> 99
        n.toInt() in 1..31 -> when (stage) {
            "alpha" -> n.toInt()
            "beta" -> 32 + n.toInt()
            else -> 64 + n.toInt()
        }
        else -> error("预发布序号需在 1..31:$v")
    }
    return major * 1_000_000 + minor * 10_000 + patch * 100 + slot
}

/* 本地签名:仓库根放一个 keystore.properties(已被 gitignore)就会签 release,
   没有则产出未签名 APK。文件内容:
     storeFile=../pulse-release.jks
     storePassword=…
     keyAlias=…
     keyPassword=…
   密钥文件本身同样不要提交。 */
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val releaseSigned = keystoreProps.isNotEmpty()

android {
    namespace = "com.noyllopa.pulse"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.noyllopa.pulse"
        minSdk = 24
        targetSdk = 34
        versionCode = versionCodeOf(pulseVersion)
        versionName = pulseVersion
    }

    signingConfigs {
        if (releaseSigned) {
            create("local") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseSigned) {
                signingConfig = signingConfigs.getByName("local")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
}

/* assemble 完成后把 APK 按 "pulse-<版本>-<变体>.apk" 复制到仓库外的产物目录,
   默认是与仓库同级的 ../release;-Ppulse.outDir=<路径> 可改。 */
val outDir = rootProject.file(findProperty("pulse.outDir") ?: "../release")

androidComponents {
    onVariants { variant ->
        val capitalised = variant.name.replaceFirstChar { it.titlecase(Locale.ROOT) }
        /* 没配密钥时 release 包是装不上的,直接把这件事写进文件名 */
        val artifactName =
            if (variant.name == "release" && !releaseSigned) "release-unsigned" else variant.name
        val copy = tasks.register("copy${capitalised}Apk", Copy::class.java) {
            description = "把 ${variant.name} 的 APK 复制到 $outDir"
            group = "build"
            /* 产物目录里除 APK 还有 output-metadata.json;不过滤的话两者会被
               rename 成同一个文件名,Gradle 直接报 duplicate */
            include("*.apk")
            from(variant.artifacts.get(SingleArtifact.APK))
            into(outDir)
            rename { "pulse-$pulseVersion-$artifactName.apk" }
        }
        /* 不能在这里 tasks.named("assembleX"):onVariants 回调跑的时候 AGP 还没建好这些任务,
           matching + configureEach 是惰性的,任务稍后出现也会挂上 */
        val assemble = "assemble$capitalised"
        tasks.matching { it.name == assemble }.configureEach { finalizedBy(copy) }
    }
}
