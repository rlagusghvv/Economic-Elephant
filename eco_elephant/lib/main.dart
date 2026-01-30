import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

void main() {
  runApp(const EcoElephantApp());
}

class EcoElephantApp extends StatelessWidget {
  const EcoElephantApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF2F6BFF),
      brightness: Brightness.light,
    );

    return MaterialApp(
      title: '경제코끼리',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        scaffoldBackgroundColor: const Color(0xFFF4F6FB),
        textTheme: GoogleFonts.notoSansKrTextTheme(),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
          centerTitle: false,
        ),
      ),
      home: const HotTopicsHome(),
    );
  }
}

class HotTopicsHome extends StatefulWidget {
  const HotTopicsHome({super.key});

  @override
  State<HotTopicsHome> createState() => _HotTopicsHomeState();
}

class _HotTopicsHomeState extends State<HotTopicsHome> {
  late Future<HotTopicsResponse> _future;

  @override
  void initState() {
    super.initState();
    _future = fetchTodayTopics();
  }

  Future<void> _refresh() async {
    setState(() {
      _future = fetchTodayTopics();
    });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: FutureBuilder<HotTopicsResponse>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              final err = snapshot.error;
              final message = err is NotFoundError
                  ? '오늘 데이터가 아직 없어요.'
                  : '불러오기에 실패했어요.';
              return _ErrorView(message: message, onRetry: _refresh);
            }
            final data = snapshot.data!;
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  _TopBar(onRefresh: _refresh),
                  const SizedBox(height: 12),
                  _HeroCard(date: data.date),
                  const SizedBox(height: 16),
                  _SectionHeader(
                    title: 'KR 핫토픽',
                    count: data.kr.length,
                  ),
                  const SizedBox(height: 8),
                  ...List.generate(
                    data.kr.length,
                    (i) => TopicBlock(index: i + 1, topic: data.kr[i]),
                  ),
                  const SizedBox(height: 16),
                  _SectionHeader(
                    title: 'WORLD 핫토픽',
                    count: data.world.length,
                  ),
                  const SizedBox(height: 8),
                  ...List.generate(
                    data.world.length,
                    (i) => TopicBlock(index: i + 1, topic: data.world[i]),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Text(
          '경제코끼리',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const Spacer(),
        IconButton(
          icon: const Icon(Icons.refresh),
          onPressed: onRefresh,
          tooltip: '새로고침',
        ),
      ],
    );
  }
}

class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.date});

  final String date;

  @override
  Widget build(BuildContext context) {
    final pretty = formatDate(date);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          colors: [Color(0xFF2F6BFF), Color(0xFF6FA8FF)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          const Text('🐘', style: TextStyle(fontSize: 28)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '오늘의 경제 핫토픽',
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 4),
                Text(
                  pretty,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.count});

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: const Color(0xFFE3ECFF),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            '$count',
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: Color(0xFF2F6BFF),
            ),
          ),
        ),
      ],
    );
  }
}

class TopicBlock extends StatelessWidget {
  const TopicBlock({super.key, required this.index, required this.topic});

  final int index;
  final HotTopic topic;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFEEF3FF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  index.toString(),
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF2F6BFF),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  topic.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    height: 1.3,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...topic.summary.map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '• $s',
                style: const TextStyle(height: 1.35),
              ),
            ),
          ),
          if (topic.tags.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: -6,
              children: topic.tags
                  .map(
                    (t) => Chip(
                      label: Text(t),
                      visualDensity: VisualDensity.compact,
                      backgroundColor: const Color(0xFFF2F4F8),
                      side: BorderSide.none,
                    ),
                  )
                  .toList(),
            ),
          ],
          if (topic.sources.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Text(
              '출처',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            ...topic.sources.map(
              (u) => InkWell(
                onTap: () => openUrl(u),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      const Icon(Icons.link, size: 16),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          u,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF2F6BFF),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: onRetry,
              child: const Text('다시 시도'),
            ),
          ],
        ),
      ),
    );
  }
}

class NotFoundError implements Exception {}

class HotTopic {
  HotTopic({
    required this.id,
    required this.title,
    required this.summary,
    required this.sources,
    required this.tags,
    this.whyItMatters,
  });

  final String id;
  final String title;
  final List<String> summary;
  final List<String> sources;
  final List<String> tags;
  final String? whyItMatters;

  factory HotTopic.fromJson(Map<String, dynamic> json) {
    return HotTopic(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      summary: (json['summary'] as List? ?? []).map((e) => '$e').toList(),
      sources: (json['sources'] as List? ?? []).map((e) => '$e').toList(),
      tags: (json['tags'] as List? ?? []).map((e) => '$e').toList(),
      whyItMatters: json['why_it_matters']?.toString(),
    );
  }
}

class HotTopicsResponse {
  HotTopicsResponse({required this.date, required this.kr, required this.world});

  final String date;
  final List<HotTopic> kr;
  final List<HotTopic> world;

  factory HotTopicsResponse.fromJson(Map<String, dynamic> json) {
    return HotTopicsResponse(
      date: (json['date'] ?? todayKstString()).toString(),
      kr: (json['kr'] as List? ?? [])
          .map((e) => HotTopic.fromJson(e))
          .toList(),
      world: (json['world'] as List? ?? [])
          .map((e) => HotTopic.fromJson(e))
          .toList(),
    );
  }
}

const String rawBaseUrl = String.fromEnvironment(
  'RAW_BASE_URL',
  defaultValue:
      'https://raw.githubusercontent.com/rlagusghvv/Economic-Elephant/main/out',
);

const String dateOverride =
    String.fromEnvironment('DATE_OVERRIDE', defaultValue: '');

String todayKstString() {
  final nowKst = DateTime.now().toUtc().add(const Duration(hours: 9));
  final yyyy = nowKst.year.toString().padLeft(4, '0');
  final mm = nowKst.month.toString().padLeft(2, '0');
  final dd = nowKst.day.toString().padLeft(2, '0');
  return '$yyyy$mm$dd';
}

String formatDate(String yyyymmdd) {
  if (yyyymmdd.length != 8) return yyyymmdd;
  final y = yyyymmdd.substring(0, 4);
  final m = yyyymmdd.substring(4, 6);
  final d = yyyymmdd.substring(6, 8);
  return '$y.$m.$d';
}

Future<HotTopicsResponse> fetchTodayTopics() async {
  final date = dateOverride.isNotEmpty ? dateOverride : todayKstString();
  final todayUrl =
      '$rawBaseUrl/daily_topics_$date.json?ek_ts=${DateTime.now().millisecondsSinceEpoch}';
  final latestUrl =
      '$rawBaseUrl/latest.json?ek_ts=${DateTime.now().millisecondsSinceEpoch}';

  final todayRes = await http.get(Uri.parse(todayUrl));
  if (todayRes.statusCode == 200) {
    final json = jsonDecode(todayRes.body) as Map<String, dynamic>;
    return HotTopicsResponse.fromJson(json);
  }

  if (todayRes.statusCode == 404) {
    final latestRes = await http.get(Uri.parse(latestUrl));
    if (latestRes.statusCode == 200) {
      final json = jsonDecode(latestRes.body) as Map<String, dynamic>;
      return HotTopicsResponse.fromJson(json);
    }
    if (latestRes.statusCode == 404) throw NotFoundError();
    throw Exception('HTTP ${latestRes.statusCode}');
  }

  throw Exception('HTTP ${todayRes.statusCode}');
}

Future<void> openUrl(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}
