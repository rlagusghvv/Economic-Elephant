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
    const primary = Color(0xFF3182F6);
    const bg = Color(0xFFF7F8FA);
    const text = Color(0xFF191F28);

    return MaterialApp(
      title: '경제코끼리',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: primary),
        scaffoldBackgroundColor: bg,
        textTheme: GoogleFonts.notoSansKrTextTheme().apply(
          bodyColor: text,
          displayColor: text,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: text,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
          iconTheme: IconThemeData(color: text),
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
  final _krController = PageController(viewportFraction: 0.92);
  final _worldController = PageController(viewportFraction: 0.92);
  int _krIndex = 0;
  int _worldIndex = 0;

  @override
  void initState() {
    super.initState();
    _future = fetchTodayTopics();
  }

  @override
  void dispose() {
    _krController.dispose();
    _worldController.dispose();
    super.dispose();
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
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
                children: [
                  _TopBar(onRefresh: _refresh),
                  const SizedBox(height: 12),
                  _HeroCard(date: data.date),
                  const SizedBox(height: 18),
                  _SectionHeader(
                    title: 'KR 핫토픽',
                    count: data.kr.length,
                  ),
                  const SizedBox(height: 8),
                  _CardPager(
                    controller: _krController,
                    count: data.kr.length,
                    index: _krIndex,
                    onPageChanged: (i) => setState(() => _krIndex = i),
                    itemBuilder: (i) =>
                        TopicBlock(index: i + 1, topic: data.kr[i]),
                  ),
                  const SizedBox(height: 16),
                  _SectionHeader(
                    title: 'WORLD 핫토픽',
                    count: data.world.length,
                  ),
                  const SizedBox(height: 8),
                  _CardPager(
                    controller: _worldController,
                    count: data.world.length,
                    index: _worldIndex,
                    onPageChanged: (i) => setState(() => _worldIndex = i),
                    itemBuilder: (i) =>
                        TopicBlock(index: i + 1, topic: data.world[i]),
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
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const Spacer(),
        _PillButton(
          label: '새로고침',
          icon: Icons.refresh,
          onTap: onRefresh,
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
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: const Color(0xFFE7F0FF),
              borderRadius: BorderRadius.circular(16),
            ),
            alignment: Alignment.center,
            child: const Text('🐘', style: TextStyle(fontSize: 24)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '오늘의 경제 핫토픽',
                  style: TextStyle(
                    color: Color(0xFF6B7684),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  pretty,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 20,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F3F5),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Text(
              '업데이트됨',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Color(0xFF6B7684),
              ),
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
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: const Color(0xFFE7F0FF),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            '$count',
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: Color(0xFF3182F6),
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
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE7F0FF),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      index.toString(),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF3182F6),
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
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              ...topic.summary.map(
                (s) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    '• $s',
                    style: const TextStyle(
                      height: 1.45,
                      color: Color(0xFF333D4B),
                    ),
                  ),
                ),
              ),
              if (topic.tags.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: -6,
                  children: topic.tags
                      .map(
                        (t) => Chip(
                          label: Text(t),
                          visualDensity: VisualDensity.compact,
                          backgroundColor: const Color(0xFFF2F4F7),
                          side: BorderSide.none,
                        ),
                      )
                      .toList(),
                ),
              ],
              if (topic.sources.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text(
                  '출처',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF6B7684),
                  ),
                ),
                const SizedBox(height: 6),
                ...topic.sources.map(
                  (u) => InkWell(
                    onTap: () => openUrl(u),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.link,
                            size: 16,
                            color: Color(0xFF3182F6),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              displayHost(u),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF3182F6),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          const Icon(
                            Icons.chevron_right,
                            size: 18,
                            color: Color(0xFFB0B8C1),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CardPager extends StatefulWidget {
  const _CardPager({
    required this.controller,
    required this.count,
    required this.index,
    required this.onPageChanged,
    required this.itemBuilder,
  });

  final PageController controller;
  final int count;
  final int index;
  final ValueChanged<int> onPageChanged;
  final Widget Function(int) itemBuilder;

  @override
  State<_CardPager> createState() => _CardPagerState();
}

class _CardPagerState extends State<_CardPager> {
  bool _stomp = false;

  void _onPageChanged(int i) {
    widget.onPageChanged(i);
    setState(() => _stomp = true);
    Future.delayed(const Duration(milliseconds: 220), () {
      if (mounted) setState(() => _stomp = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.count == 0) {
      return const SizedBox.shrink();
    }

    final h = MediaQuery.of(context).size.height;
    final cardHeight = (h * 0.48).clamp(300.0, 420.0);

    return Column(
      children: [
        SizedBox(
          height: cardHeight,
          child: Stack(
            children: [
              PageView.builder(
                controller: widget.controller,
                itemCount: widget.count,
                onPageChanged: _onPageChanged,
                itemBuilder: (context, i) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  child: widget.itemBuilder(i),
                ),
              ),
              Positioned(
                right: 14,
                bottom: 14,
                child: AnimatedScale(
                  duration: const Duration(milliseconds: 220),
                  scale: _stomp ? 1.0 : 0.6,
                  child: AnimatedOpacity(
                    duration: const Duration(milliseconds: 220),
                    opacity: _stomp ? 1.0 : 0.0,
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE7F0FF),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Text('🐘', style: TextStyle(fontSize: 18)),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        _DotsIndicator(count: widget.count, index: widget.index),
      ],
    );
  }
}

class _DotsIndicator extends StatelessWidget {
  const _DotsIndicator({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(
        count,
        (i) => AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          margin: const EdgeInsets.symmetric(horizontal: 4),
          width: i == index ? 18 : 6,
          height: 6,
          decoration: BoxDecoration(
            color: i == index ? const Color(0xFF3182F6) : const Color(0xFFDDE2E8),
            borderRadius: BorderRadius.circular(999),
          ),
        ),
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
            _PillButton(
              label: '다시 시도',
              icon: Icons.refresh,
              onTap: onRetry,
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

String displayHost(String url) {
  try {
    final host = Uri.parse(url).host;
    return host.isEmpty ? url : host;
  } catch (e) {
    return url;
  }
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

class _PillButton extends StatelessWidget {
  const _PillButton({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: const Color(0xFFE5E8EB)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: const Color(0xFF6B7684)),
            const SizedBox(width: 6),
            Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Color(0xFF333D4B),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
